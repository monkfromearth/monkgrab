// MonkGrab page converter: DOM -> Markdown, run inside every frame of the tab.
// background.js loads this file with importScripts() and injects extractFrame with
// chrome.scripting.executeScript({ func: extractFrame }). Chrome serializes the
// function, so it must stay self-contained: nothing outside it exists in the page.

// Returns { url, title, md, len, stats, warnings } for this frame: its Markdown, a
// length to rank frames by, form stats, and warnings about content not on the page.
function extractFrame() {
  // ---- Rules ------------------------------------------------------------------

  // Tags that never hold readable content. FORM and BUTTON are deliberately NOT here:
  // on task and form pages the whole job sits inside one <form>, and toggles are buttons.
  const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "SVG", "TEMPLATE", "IFRAME", "OBJECT", "CANVAS", "LINK", "META"]);
  const PHRASING = new Set(["A", "ABBR", "B", "CODE", "EM", "I", "KBD", "MARK", "Q", "S", "SMALL", "STRONG", "SUB", "SUP", "TIME", "U"]);
  const FIELDS = new Set(["INPUT", "TEXTAREA", "SELECT"]);
  const NO_VALUE_INPUTS = new Set(["hidden", "submit", "button", "reset", "image"]);
  // Roles a custom option can have. Any other role (treeitem, row, gridcell...) uses
  // aria-selected for navigation, not for an answer.
  const OPTION_ROLES = new Set(["", "button", "radio", "option", "tab", "menuitemradio", "checkbox", "switch", "menuitemcheckbox"]);
  // Weak option signals (aria-pressed, data-state, a "selected" class, tabs, menu items)
  // also mark Like buttons, menus and code tabs, so they count only in this scope.
  const FORM_SCOPE = "form,[role=form],[role=radiogroup],[role=group],[role=listbox]";
  const CHOICE_GROUP = "[role=radiogroup],[role=tablist],[role=listbox]";
  const CHOICE_CONTROLS = "select,input[type=radio],input[type=checkbox],[role=radio],[role=checkbox],[role=switch]";
  // Code editors (Monaco, CodeMirror 5) keep a hidden helper textarea for typing.
  const EDITOR_HELPER = ".inputarea, .monaco-editor textarea, .CodeMirror textarea";
  const SEARCHY = /search|query|filter|find/i;
  const STATE_CLASS = /(^|[-_])(checked|selected|active)$/i;
  // Maps, not object literals: an attribute value like "constructor" must not match.
  const ARIA_STATE = new Map([["true", "x"], ["false", " "], ["mixed", "-"]]);
  const DATA_STATE = new Map([["checked", "x"], ["on", "x"], ["active", "x"], ["selected", "x"],
    ["indeterminate", "-"], ["unchecked", " "], ["off", " "], ["inactive", " "]]);
  // Where an unfilled "expand" control is a menu or pop-up, not hidden content.
  const MENU_AREAS = "nav,header,footer,[role=navigation],[role=banner],[role=menu],[role=menubar]";

  const OUTSIDE_MAIN_PROSE = 1500; // non-link characters outside <main> that get appended
  const UI_FORM_TEXT = 400;        // a form with less text and nothing to answer is page UI
  const CARD_BUTTON_TEXT = 60;     // a button with more text is a clickable card, not "Copy"
  const SELECT_OPTIONS_LISTED = 15;

  // Private characters page text never contains, removed before the Markdown is returned:
  // OPT starts every option line, so a group of options can sit on adjacent lines, and
  // "\u0000N\u0000" holds verbatim text (<pre>, textareas) out of the whitespace clean-up.
  const OPT = "\u0001";

  // ---- Walk state -------------------------------------------------------------

  // Elements already written. Kept across both passes (main content, then the rest),
  // so a label printed with its control in <main> is not printed again outside it.
  const done = new Set();
  const groupCache = new Map();
  // What one render() pass collects; reset by render().
  let pass;

  // ---- Text helpers -----------------------------------------------------------

  // Resolve relative href/src to absolute against this frame's URL, so links and
  // images still work once the .md is saved off-site. Falls back to the raw value.
  function abs(u) {
    try { return new URL(u, location.href).href; } catch (_) { return u; }
  }

  function squash(s) { return (s || "").replace(/\s+/g, " ").trim(); }

  // Text of an element with form controls left out (or, with vals, replaced by their
  // value; never a password). Non-phrasing elements get a space on each side so
  // adjacent <span>s don't run together ("Score" + "*" -> "Score *").
  function plainText(el, vals) {
    let s = "";
    el.childNodes.forEach((c) => {
      if (c.nodeType === 3) s += c.textContent;
      else if (c.nodeType === 1) {
        const t = c.tagName.toUpperCase();
        if (SKIP.has(t)) return;
        if (FIELDS.has(t)) {
          if (vals && c.type !== "password" && c.type !== "hidden") s += " " + c.value + " ";
          return;
        }
        s += PHRASING.has(t) ? plainText(c, vals) : " " + plainText(c, vals) + " ";
      }
    });
    return s;
  }
  function textOf(el, vals) { return squash(plainText(el, vals)); }

  function stash(text) {
    pass.tokens.push(text);
    return "\u0000" + (pass.tokens.length - 1) + "\u0000";
  }
  // A code fence longer than any backtick run inside the text.
  function fence(text) {
    const longest = Math.max(2, ...(text.match(/`+/g) || []).map((r) => r.length));
    const f = "`".repeat(longest + 1);
    return f + "\n" + text.replace(/\n+$/, "") + "\n" + f;
  }

  // A logo heading is often just an <svg>; keep its name (<h1><svg><title>News).
  function svgName(svg) {
    if (svg.getAttribute("aria-hidden") === "true") return "";
    const title = svg.querySelector("title");
    return squash(svg.getAttribute("aria-label") || (title && title.textContent) || "");
  }

  // ---- Page UI: what never goes in the file -----------------------------------

  // Site chrome: every <nav>, and any <header>/<footer> that is not an article's own
  // (an article header holds its title and byline).
  function isChrome(el, tag) {
    if (tag === "NAV") return true;
    if (tag !== "HEADER" && tag !== "FOOTER") return false;
    const p = el.parentElement;
    return !(p && p.closest("article,form,dialog,[role=dialog]"));
  }

  // A small search, sign-up, log-in or comment form: no choices, nothing typed, little
  // text. Big forms (a whole task page) are always walked.
  function isUiForm(form) {
    if (form.querySelector(CHOICE_CONTROLS)) return false;
    const typed = (i) => !NO_VALUE_INPUTS.has(i.type) && i.type !== "password" && !i.matches(EDITOR_HELPER) && i.value.trim();
    if ([...form.querySelectorAll("input,textarea")].some(typed)) return false;
    return squash(form.textContent).length < UI_FORM_TEXT;
  }

  // Block-level subtrees left out. (Inline text only drops SKIP tags: 1.0.1 kept a
  // <nav> inside a list item, and ordinary pages must come out as they did.)
  function isNoise(el, tag) {
    return SKIP.has(tag) || isChrome(el, tag) || (tag === "FORM" && isUiForm(el)) ||
      // Carousel libraries clone slides for looping; the originals are walked anyway.
      el.classList.contains("swiper-slide-duplicate") || el.classList.contains("slick-cloned");
  }

  // Fields that are page machinery, not answers.
  function isUiField(el, tag, type) {
    if (el.getAttribute("aria-hidden") === "true") return true; // mirror behind a custom widget (Radix, Headless UI)
    if (tag === "TEXTAREA") return el.matches(EDITOR_HELPER);
    if (tag !== "INPUT" || type === "radio" || type === "checkbox") return false;
    if (NO_VALUE_INPUTS.has(type)) return true;
    return !el.value && (type === "search" || el.getAttribute("role") === "combobox" ||
      SEARCHY.test([el.name, el.id, el.placeholder, el.getAttribute("aria-label")].join(" ")));
  }

  // ---- Form state -------------------------------------------------------------
  // One fixed marker per control type, so a script can grep it:
  //   (x) / ( )  single choice: radio, role=radio/option/tab, class-only option group
  //   [x] / [ ]  independent toggle: checkbox, switch, aria-pressed button ([-] = mixed)
  //   Selected:  <select>        Value:  text fields (textarea value in a fenced block)
  // State always comes from the LIVE DOM (input.checked, select.value, textarea.value),
  // never the HTML attribute, because the user changes these after page load.

  function classOn(el) {
    return !!(el && el.classList) && [...el.classList].some((c) => !c.includes(":") && STATE_CLASS.test(c));
  }

  // Class-only option groups: same-tag siblings where some, not all, carry a
  // checked/selected/active class, e.g. <div class="opt selected">PASS</div><div class="opt">FAIL</div>.
  function classGroup(el) {
    const p = el.parentElement;
    if (!p) return false;
    if (!groupCache.has(p)) {
      const kids = [...p.children];
      const on = kids.filter(classOn).length;
      groupCache.set(p, kids.length >= 2 && kids.length <= 30 && on >= 1 && on < kids.length &&
        kids.every((k) => k.tagName === kids[0].tagName && squash(k.textContent).length <= 120));
    }
    return groupCache.get(p);
  }

  // A radio when it sits in a choice group, else a checkbox.
  function grouped(el) { return el.closest(CHOICE_GROUP) ? "radio" : "check"; }

  // Explicit ARIA semantics: an option wherever it is.
  function strongKind(el, role) {
    if (role === "radio" || role === "option") return "radio";
    if (role === "checkbox" || role === "switch") return "check";
    if (el.hasAttribute("aria-checked")) return grouped(el);
    return null;
  }

  // Signals that also mark page UI; optionKind only trusts them inside FORM_SCOPE.
  function weakKind(el, role, tag) {
    if (role === "tab" || role === "menuitemradio") return "radio";
    if (role === "menuitemcheckbox") return "check";
    if (el.hasAttribute("aria-pressed")) return "check";
    if ((tag === "BUTTON" || role === "button") && el.hasAttribute("aria-selected")) return "radio";
    const ds = (el.getAttribute("data-state") || "").toLowerCase();
    if (ds === "checked" || ds === "unchecked" || ds === "indeterminate") return grouped(el);
    if (ds === "on" || ds === "off") return "check";
    if (el.hasAttribute("data-checked")) return grouped(el);
    if (classGroup(el)) return "radio";
    return null;
  }

  // Is this a custom (non-native) choice control? "radio", "check", or null.
  function optionKind(el, tag) {
    if (FIELDS.has(tag) || tag === "LABEL") return null;
    const role = (el.getAttribute("role") || "").toLowerCase();
    if (!OPTION_ROLES.has(role)) return null;
    let kind = strongKind(el, role);
    if (!kind) {
      kind = weakKind(el, role, tag);
      if (kind && !el.closest(FORM_SCOPE)) kind = null;
    }
    // A native radio/checkbox inside decides the state (its live .checked is exact).
    return kind && !el.querySelector("input[type=radio],input[type=checkbox]") ? kind : null;
  }

  // State of a custom option, whichever signal made it one: aria-*, then data-state,
  // then data-*, then a state class on the option or on a wrapper that holds only it.
  function customState(el) {
    for (const a of ["aria-checked", "aria-pressed", "aria-selected"]) {
      const st = ARIA_STATE.get((el.getAttribute(a) || "").toLowerCase());
      if (st) return st;
    }
    const st = DATA_STATE.get((el.getAttribute("data-state") || "").toLowerCase());
    if (st) return st;
    for (const a of ["data-checked", "data-selected", "data-active"]) {
      if (el.hasAttribute(a)) return el.getAttribute(a) === "false" ? " " : "x";
    }
    const p = el.parentElement;
    return classOn(el) || (p && p.children.length <= 2 && classOn(p)) ? "x" : " ";
  }

  // A control's name from aria-labelledby or its <label>s. The label elements are
  // marked done so they aren't printed a second time when the walk reaches them.
  function nameOf(el) {
    const ids = (el.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean);
    let nodes = ids.map((id) => document.getElementById(id)).filter(Boolean);
    if (!nodes.length && el.labels) nodes = [...el.labels];
    nodes.forEach((n) => done.add(n));
    return squash(nodes.map((n) => textOf(n)).join(" "));
  }

  // "(x) PASS" / "[ ] Optional", with the OPT mark in front. kind is "radio" or "check".
  function optionLine(el, kind) {
    done.add(el);
    const native = el.tagName.toUpperCase() === "INPUT";
    const st = native ? (el.indeterminate ? "-" : el.checked ? "x" : " ") : customState(el);
    const name = nameOf(el) || (!native && textOf(el)) ||
      squash(el.getAttribute("aria-label") || el.getAttribute("title") || "") ||
      (native && el.value && el.value !== "on" ? el.value : "");
    const s = pass.stats;
    if (kind === "radio" && el.getAttribute("role") !== "tab") {
      s.radios++;
      if (st === "x") s.picked++;
      const key = native && el.name ? (el.form ? el.form.id || "form" : "") + "|" + el.name
        : el.closest("[role=radiogroup],[role=listbox]") || el.parentElement;
      pass.groups.set(key, pass.groups.get(key) || st === "x");
    } else if (kind === "check") {
      s.checks++;
      if (st === "x") s.checked++;
    }
    return OPT + (kind === "radio" ? "(" + st + ")" : "[" + st + "]") + (name ? " " + name : "");
  }

  // A native field -> marker text. inl = inside a line of text (list item, paragraph).
  function control(el, inl) {
    if (done.has(el)) return "";
    done.add(el);
    const tag = el.tagName.toUpperCase();
    const type = (el.type || "text").toLowerCase();
    if (isUiField(el, tag, type)) return "";
    const s = pass.stats;
    if (tag === "SELECT") {
      s.selects++;
      const picked = [...el.selectedOptions].map((o) => squash(o.textContent));
      const all = [...el.options].map((o) => squash(o.textContent));
      let v = "Selected: " + (picked.length ? picked.join("; ") : "(none)");
      if (all.length > 1 && all.length <= SELECT_OPTIONS_LISTED) v += " (options: " + all.join(" | ") + ")";
      return inl ? "[" + v + "]" : v;
    }
    if (tag === "TEXTAREA") {
      s.texts++;
      if (!el.value.trim()) return inl ? "[Value: (empty)]" : "Value: (empty)";
      s.filled++;
      pass.filledAreas++;
      return "Value:" + stash("\n" + fence(el.value) + (inl ? "\n" : ""));
    }
    if (type === "radio" || type === "checkbox") return optionLine(el, type === "radio" ? "radio" : "check");
    if (type === "file") {
      const names = [...(el.files || [])].map((f) => f.name);
      return "Files: " + (names.length ? names.join(", ") : "(none)");
    }
    s.texts++;
    if (el.value) s.filled++;
    const v = "Value: " + (type === "password" ? (el.value ? "(password, not saved)" : "(empty)") : el.value || "(empty)");
    if (inl) return "[" + v + "]";
    // No <label>: print its aria-label or placeholder as the label line.
    const hint = el.labels && el.labels.length ? "" : squash(el.getAttribute("aria-label") || el.getAttribute("placeholder") || "");
    return (hint ? hint + "\n\n" : "") + v;
  }

  // A <label>. Radio/checkbox/custom-option labels become one marker line; a label
  // wrapping a text field prints its words, then the field's value.
  function labelText(lab, inl) {
    done.add(lab);
    const ctl = lab.control;
    if (ctl && !done.has(ctl)) {
      const tag = ctl.tagName.toUpperCase();
      if (tag === "INPUT" && /^(radio|checkbox)$/i.test(ctl.type)) return control(ctl, inl);
      const kind = optionKind(ctl, tag);
      if (kind) return optionLine(ctl, kind);
      if (lab.contains(ctl)) {
        const words = textOf(lab);
        const val = control(ctl, inl);
        return (words ? words + (inl ? " " : "\n\n") : "") + val;
      }
    }
    return inline(lab).trim();
  }

  // Form markup -> its marker text, or null when el is not a label, field or option.
  // The one place inline() and block() decide this.
  function formText(el, tag, inl) {
    if (tag === "LABEL") return labelText(el, inl);
    if (FIELDS.has(tag)) return control(el, inl);
    const kind = optionKind(el, tag);
    return kind ? optionLine(el, kind) : null;
  }

  // ---- Markdown ---------------------------------------------------------------

  function inline(node, skipLists) {
    let out = "";
    node.childNodes.forEach((c) => {
      if (c.nodeType === 3) {
        const t = c.textContent.replace(/\s+/g, " ");
        out += t;
        pass.prose += t.trim().length;
        return;
      }
      if (c.nodeType !== 1 || done.has(c)) return;
      // SVG and other non-HTML elements report a case-sensitive tagName; normalize.
      const t = c.tagName.toUpperCase();
      if (t === "SVG") { out += svgName(c); return; }
      if (SKIP.has(t) || (skipLists && (t === "UL" || t === "OL"))) return;
      const f = formText(c, t, true);
      if (f !== null) { out += " " + f + " "; return; }
      if (t === "BR") out += "\n";
      else if (t === "STRONG" || t === "B") out += "**" + inline(c, skipLists).trim() + "**";
      else if (t === "EM" || t === "I") out += "*" + inline(c, skipLists).trim() + "*";
      else if (t === "CODE") { out += "`" + c.textContent + "`"; pass.prose += c.textContent.length; }
      else if (t === "A") {
        const href = c.getAttribute("href") || "";
        const before = pass.prose;
        const txt = inline(c, skipLists).trim();
        if (href) pass.prose = before; // link text is not prose (menus are all links)
        out += href ? `[${txt}](${abs(href)})` : txt;
      } else if (t === "IMG") {
        const src = c.getAttribute("src") || "";
        const alt = c.getAttribute("alt") || "";
        out += src ? `![${alt}](${abs(src)})` : "";
      } else out += inline(c, skipLists);
    });
    return out;
  }

  // Render a <ul>/<ol> and its nested sub-lists as indented Markdown bullets.
  // Robust to invalid markup (e.g. <ul><p><li>...</ul>): list membership is decided
  // by each <li>'s nearest list ancestor, and the item's own text skips nested lists,
  // so nested items never collapse into their parent line. (No cloning: a clone
  // would lose live form state.)
  function renderList(list, baseDepth) {
    let out = "";
    const counters = new Map();
    list.querySelectorAll("li").forEach((li) => {
      const owner = li.closest("ul,ol");
      if (!owner || !list.contains(owner) || done.has(li)) return;
      let depthN = 0, a = owner;
      while (a && a !== list) { if (a.tagName === "UL" || a.tagName === "OL") depthN++; a = a.parentElement; }
      let mark;
      if (owner.tagName === "OL") { const n = (counters.get(owner) || 0) + 1; counters.set(owner, n); mark = n + ". "; }
      else mark = "- ";
      const line = inline(li, true).replace(/\s+/g, " ").trim();
      if (line) out += "  ".repeat(baseDepth + depthN) + mark + line + "\n";
    });
    return out;
  }

  function block(node, depth) {
    let md = "";
    node.childNodes.forEach((c) => {
      if (c.nodeType === 3) {
        const t = c.textContent.replace(/\s+/g, " ").trim();
        if (t) { md += t + "\n\n"; pass.prose += t.length; }
        return;
      }
      if (c.nodeType !== 1 || done.has(c)) return;
      const tag = c.tagName.toUpperCase();
      if (isNoise(c, tag)) return;
      const f = formText(c, tag, false);
      if (f !== null) {
        if (f) md += f + "\n\n";
      } else if (tag === "BUTTON") {
        // Plain action buttons ("Copy", "Submit") are UI. A long one is a clickable card.
        if (textOf(c).length > CARD_BUTTON_TEXT) md += block(c, depth);
      } else if (/^H[1-6]$/.test(tag)) {
        md += "#".repeat(+tag[1]) + " " + inline(c).trim() + "\n\n";
      } else if (tag === "P") {
        const t = inline(c).trim();
        if (t) md += t + "\n\n";
      } else if (tag === "UL" || tag === "OL") {
        md += renderList(c, depth) + "\n";
      } else if (tag === "PRE") {
        md += stash(fence(c.textContent)) + "\n\n";
        pass.prose += c.textContent.length;
      } else if (tag === "BLOCKQUOTE") {
        md += "> " + inline(c).trim().replace(/\n/g, "\n> ") + "\n\n";
      } else if (tag === "HR") {
        md += "---\n\n";
      } else if (tag === "IMG") {
        md += inline(c) + "\n\n";
      } else {
        md += block(c, depth); // descend into divs/sections/forms/etc.
      }
    });
    return md;
  }

  // One pass over root (skipping anything already done) -> Markdown, form stats,
  // non-link text length, and how many text areas were filled in.
  function render(root) {
    pass = {
      tokens: [], groups: new Map(), prose: 0, filledAreas: 0,
      stats: { radios: 0, picked: 0, groups: 0, unpicked: 0, checks: 0, checked: 0, selects: 0, texts: 0, filled: 0 },
    };
    const lines = block(root, 0).replace(/\n{3,}/g, "\n\n").trim().split("\n");
    // Options of one group sit on adjacent lines, so the group reads as one block.
    const isOpt = (l) => !!l && l.startsWith(OPT);
    const md = lines.filter((l, i) => !(l === "" && isOpt(lines[i - 1]) && isOpt(lines[i + 1])))
      .join("\n").split(OPT).join("")
      .replace(/\u0000(\d+)\u0000/g, (_, i) => pass.tokens[+i]);
    pass.stats.groups = pass.groups.size;
    pass.stats.unpicked = [...pass.groups.values()].filter((v) => !v).length;
    return { md, stats: pass.stats, prose: pass.prose, filledAreas: pass.filledAreas };
  }

  // ---- Warnings ---------------------------------------------------------------

  // Content that shows one item at a time and may not be on the page at all.
  function hiddenPanelWarnings() {
    const out = new Set();
    const pager = /\b(item|slide|card|question|step|panel|rubric)\s*(\d+)\s*(?:of|\/)\s*(\d+)\b/i;
    const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
    let n, hits = 0;
    // Check at most 500 "N of M" text nodes, climbing at most 4 short parents each, so
    // "item <input value=1> of 8", split across nodes, still matches.
    while ((n = walker.nextNode()) && hits < 500) {
      if (!/(^|\s|\d)(of|\/)\s*\d+\s*$|\d+\s*(of|\/)\s*\d+/i.test(n.textContent)) continue;
      hits++;
      let el = n.parentElement;
      for (let up = 0; el && up < 4; up++, el = el.parentElement) {
        if (el.textContent.length > 200) break;
        const t = textOf(el, true);
        const m = t.match(pager);
        if (m && +m[3] > 1) {
          out.add(`"${t.length <= 80 ? t : m[0]}": this part of the page shows one item at a time, so items that are not on screen may be missing below. If the page has a List view, switch to it and grab again.`);
          break;
        }
      }
    }
    document.querySelectorAll("[role=tablist]").forEach((list) => {
      const tabs = [...list.querySelectorAll("[role=tab][aria-controls]")];
      const missing = tabs.filter((t) => !document.getElementById(t.getAttribute("aria-controls")));
      if (missing.length) {
        out.add(`${missing.length} of ${tabs.length} tabs (${missing.map((t) => textOf(t)).join(", ")}) have no panel on the page; their content is missing below. Open each tab and grab again.`);
      }
    });
    // Menus and pop-ups render on open too; only named sections in the content count.
    const shut = [...document.querySelectorAll("[aria-expanded=false][aria-controls]")]
      .filter((b) => !document.getElementById(b.getAttribute("aria-controls")) && !b.hasAttribute("aria-haspopup") &&
        !b.closest(MENU_AREAS) && textOf(b));
    if (shut.length) {
      out.add(`${shut.length} collapsed section(s) have no content on the page (${shut.slice(0, 5).map((b) => textOf(b)).join(", ")}); expand them and grab again.`);
    }
    return [...out];
  }

  // ---- This frame -------------------------------------------------------------

  const body = document.body || document.documentElement;
  if (!body) return { url: location.href, title: "", md: "", len: 0, stats: null, warnings: [] };

  // The main content goes first. Anything outside it with real prose (link text doesn't
  // count, so menus and link lists don't qualify) or a filled-in text area is appended,
  // never dropped. Pages with no <main> (most task pages) use <body>.
  const found = document.querySelector("main") || document.querySelector("[role=main]") || document.querySelector("article");
  const main = found && found !== body ? found : null;
  const first = render(main || body);
  let md = first.md;
  const stats = first.stats;
  if (main) {
    done.add(main);
    const rest = render(body);
    if (rest.prose >= OUTSIDE_MAIN_PROSE || rest.filledAreas > 0) {
      md += "\n\n---\n<!-- outside the main content -->\n\n" + rest.md;
      for (const k in stats) stats[k] += rest.stats[k];
    }
  }
  return { url: location.href, title: document.title || "", md, len: md.length, stats, warnings: hiddenPanelWarnings() };
}
