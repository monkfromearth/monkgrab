// MonkGrab: webpage to Markdown service worker.
// Injects into EVERY frame of the active tab (allFrames bypasses the cross-origin
// iframe wall, since the function runs inside each frame's own context), converts
// each content frame's DOM to Markdown right there, then downloads ONE .md file
// named <domain>_<path>_<datetime>.md. No external tools, no second step.

// Runs inside each frame. Self-contained (serialized by chrome.scripting) DOM ->
// Markdown walker. Returns this frame's markdown, a length to rank frames by, form
// stats, and warnings about content that is not on the page.
function extractFrame() {
  // Tags that never hold readable content. FORM and BUTTON are deliberately NOT here:
  // on task and form pages the whole job sits inside one <form>, and toggles are buttons.
  const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "SVG", "TEMPLATE", "IFRAME", "OBJECT", "CANVAS", "LINK", "META"]);
  const PHRASING = new Set(["A", "ABBR", "B", "CODE", "EM", "I", "KBD", "MARK", "Q", "S", "SMALL", "STRONG", "SUB", "SUP", "TIME", "U"]);
  const RADIO_ROLES = new Set(["radio", "option", "tab", "menuitemradio"]);
  const CHECK_ROLES = new Set(["checkbox", "switch", "menuitemcheckbox"]);
  const NO_VALUE_INPUTS = new Set(["hidden", "submit", "button", "reset", "image"]);
  const STATE_CLASS = /(^|[-_])(checked|selected|active)$/i;
  // Weaker signals (aria-pressed, data-state, a "selected" class, tabs, menu items) also
  // mark Like/Follow buttons, menus and code tabs on ordinary pages, so they count as
  // answers only inside a form or an explicit choice group.
  const FORM_SCOPE = "form,[role=form],[role=radiogroup],[role=group],[role=listbox]";
  const ANSWER_CONTROLS = "textarea,select,input[type=radio],input[type=checkbox],[role=radio],[role=checkbox],[role=switch]";
  const SEARCHY = /search|query|filter|find/i;
  // Code editors (Monaco, CodeMirror 5) keep a hidden helper textarea for typing.
  const EDITOR_HELPER = ".inputarea, .monaco-editor textarea, .CodeMirror textarea";

  // Per-render state, reset by render().
  let done, tokens, groupCache, stats, groups;

  // Resolve relative href/src to absolute against this frame's URL, so links and
  // images still work once the .md is saved off-site. Falls back to the raw value.
  function abs(u) {
    try { return new URL(u, location.href).href; } catch (_) { return u; }
  }

  function squash(s) { return (s || "").replace(/\s+/g, " ").trim(); }

  // Text of an element with form controls left out (or, with vals, replaced by their
  // value). Non-phrasing elements get a space on each side so adjacent <span>s don't
  // run together ("Score" + "*" -> "Score *").
  function plainText(el, vals) {
    let s = "";
    el.childNodes.forEach((c) => {
      if (c.nodeType === 3) s += c.textContent;
      else if (c.nodeType === 1) {
        const t = c.tagName.toUpperCase();
        if (SKIP.has(t)) return;
        if (t === "INPUT" || t === "TEXTAREA" || t === "SELECT") { if (vals) s += " " + c.value + " "; return; }
        s += PHRASING.has(t) ? plainText(c, vals) : " " + plainText(c, vals) + " ";
      }
    });
    return s;
  }
  function textOf(el, vals) { return squash(plainText(el, vals)); }

  // Long values (textareas, <pre>) are stashed as tokens and put back after the
  // whitespace clean-up, so their blank lines and spacing survive verbatim.
  function stash(text) {
    tokens.push(text);
    return "\u0000" + (tokens.length - 1) + "\u0000";
  }
  function fence(text) {
    const longest = Math.max(2, ...(text.match(/`+/g) || []).map((r) => r.length));
    const f = "`".repeat(longest + 1);
    return f + "\n" + text.replace(/\n+$/, "") + "\n" + f;
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

  // Is this a custom (non-native) choice control? "radio", "check", or null.
  function optionKind(el) {
    const tag = el.tagName.toUpperCase();
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "LABEL") return null;
    const role = (el.getAttribute("role") || "").toLowerCase();
    // treeitem, row, gridcell...: aria-selected there is navigation, not an answer.
    if (role && role !== "button" && !RADIO_ROLES.has(role) && !CHECK_ROLES.has(role)) return null;
    const grouped = () => (el.closest("[role=radiogroup],[role=tablist],[role=listbox]") ? "radio" : "check");
    const ds = (el.getAttribute("data-state") || "").toLowerCase();
    let kind = null;
    if (role === "radio" || role === "option") kind = "radio";
    else if (role === "checkbox" || role === "switch") kind = "check";
    else if (el.hasAttribute("aria-checked")) kind = grouped();
    else if (!el.closest(FORM_SCOPE)) return null;
    else if (RADIO_ROLES.has(role)) kind = "radio";
    else if (CHECK_ROLES.has(role)) kind = "check";
    else if (el.hasAttribute("aria-pressed")) kind = "check";
    else if ((tag === "BUTTON" || role === "button") && el.hasAttribute("aria-selected")) kind = "radio";
    else if (ds === "checked" || ds === "unchecked" || ds === "indeterminate") kind = grouped();
    else if (ds === "on" || ds === "off") kind = "check";
    else if (el.hasAttribute("data-checked")) kind = grouped();
    else if (classGroup(el)) kind = "radio";
    // A native radio/checkbox inside decides the state (its live .checked is exact).
    if (kind && el.querySelector("input[type=radio],input[type=checkbox]")) return null;
    return kind;
  }

  // State of a custom option: aria-*, then data-*, then a state class on the option
  // or on a wrapper that holds only this option.
  function customState(el) {
    for (const a of ["aria-checked", "aria-pressed", "aria-selected"]) {
      const v = (el.getAttribute(a) || "").toLowerCase();
      if (v === "true") return "x";
      if (v === "mixed") return "-";
      if (v === "false") return " ";
    }
    const ds = (el.getAttribute("data-state") || "").toLowerCase();
    if (ds === "checked" || ds === "on" || ds === "active" || ds === "selected") return "x";
    if (ds === "indeterminate") return "-";
    if (ds === "unchecked" || ds === "off" || ds === "inactive") return " ";
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
    return squash(nodes.map(textOf).join(" "));
  }

  // "(x) PASS" / "[ ] Optional". kind is "radio" or "check".
  function optionLine(el, kind) {
    done.add(el);
    const native = el.tagName.toUpperCase() === "INPUT";
    let st;
    if (native) st = el.indeterminate ? "-" : el.checked ? "x" : " ";
    else st = customState(el);
    let name = nameOf(el);
    if (!name && !native) name = textOf(el);
    if (!name) name = squash(el.getAttribute("aria-label") || el.getAttribute("title") || "");
    if (!name && native && el.value && el.value !== "on") name = el.value;
    if (kind === "radio" && el.getAttribute("role") !== "tab") {
      stats.radios++;
      if (st === "x") stats.picked++;
      const key = native && el.name ? (el.form ? el.form.id || "form" : "") + "|" + el.name
        : el.closest("[role=radiogroup],[role=listbox]") || el.parentElement;
      groups.set(key, groups.get(key) || st === "x");
    } else if (kind === "check") {
      stats.checks++;
      if (st === "x") stats.checked++;
    }
    return (kind === "radio" ? "(" + st + ")" : "[" + st + "]") + (name ? " " + name : "");
  }

  // Native control -> marker text. inl = inside a line of text (list item, paragraph).
  function control(el, inl) {
    if (done.has(el)) return "";
    done.add(el);
    const tag = el.tagName.toUpperCase();
    // Mirror inputs behind custom widgets (Radix, headless UI) duplicate the widget.
    if (el.getAttribute("aria-hidden") === "true") return "";
    if (tag === "SELECT") {
      stats.selects++;
      const picked = [...el.selectedOptions].map((o) => squash(o.textContent));
      const all = [...el.options].map((o) => squash(o.textContent));
      let s = "Selected: " + (picked.length ? picked.join("; ") : "(none)");
      if (all.length > 1 && all.length <= 15) s += " (options: " + all.join(" | ") + ")";
      return inl ? "[" + s + "]" : s;
    }
    if (tag === "TEXTAREA") {
      if (el.matches(EDITOR_HELPER)) return "";
      stats.texts++;
      if (!el.value.trim()) return inl ? "[Value: (empty)]" : "Value: (empty)";
      stats.filled++;
      return "Value:" + stash("\n" + fence(el.value) + (inl ? "\n" : ""));
    }
    const type = (el.type || "text").toLowerCase();
    if (NO_VALUE_INPUTS.has(type)) return "";
    if (type === "radio" || type === "checkbox") return optionLine(el, type === "radio" ? "radio" : "check");
    // Empty search boxes are page UI, not answers.
    if (!el.value && (type === "search" || el.getAttribute("role") === "combobox" ||
      SEARCHY.test([el.name, el.id, el.placeholder, el.getAttribute("aria-label")].join(" ")))) return "";
    if (type === "file") {
      const names = [...(el.files || [])].map((f) => f.name);
      return "Files: " + (names.length ? names.join(", ") : "(none)");
    }
    stats.texts++;
    if (el.value) stats.filled++;
    const v = type === "password" ? (el.value ? "(password, not saved)" : "(empty)") : el.value || "(empty)";
    let s = "Value: " + v;
    if (inl) return "[" + s + "]";
    // No <label>: print its aria-label or placeholder as the label line.
    const hint = el.labels && el.labels.length ? "" : squash(el.getAttribute("aria-label") || el.getAttribute("placeholder") || "");
    return (hint ? hint + "\n\n" : "") + s;
  }

  // A <label>. Radio/checkbox/custom-option labels become one marker line; a label
  // wrapping a text field prints its words, then the field's value.
  function labelText(lab, inl) {
    done.add(lab);
    const ctl = lab.control;
    if (ctl && !done.has(ctl)) {
      const tag = ctl.tagName.toUpperCase();
      if (tag === "INPUT" && /^(radio|checkbox)$/i.test(ctl.type)) return control(ctl, inl);
      const kind = optionKind(ctl);
      if (kind) return optionLine(ctl, kind);
      if (lab.contains(ctl)) {
        const words = textOf(lab);
        const val = control(ctl, inl);
        return (words ? words + (inl ? " " : "\n\n") : "") + val;
      }
    }
    return inline(lab).trim();
  }

  // ---- Markdown ---------------------------------------------------------------

  function inline(node, skipLists) {
    let out = "";
    node.childNodes.forEach((c) => {
      if (c.nodeType === 3) out += c.textContent.replace(/\s+/g, " ");
      else if (c.nodeType === 1 && !done.has(c)) {
        // SVG and other non-HTML elements report a case-sensitive tagName; normalize.
        const t = c.tagName.toUpperCase();
        // A logo heading is often just an <svg>; keep its name (<h1><svg><title>News).
        if (t === "SVG") { out += svgName(c); return; }
        if (SKIP.has(t) || (skipLists && (t === "UL" || t === "OL"))) return;
        if (t === "LABEL") { out += " " + labelText(c, true) + " "; return; }
        if (t === "INPUT" || t === "TEXTAREA" || t === "SELECT") { out += " " + control(c, true) + " "; return; }
        const kind = optionKind(c);
        if (kind) { out += " " + optionLine(c, kind) + " "; return; }
        if (t === "BR") out += "\n";
        else if (t === "STRONG" || t === "B") out += "**" + inline(c, skipLists).trim() + "**";
        else if (t === "EM" || t === "I") out += "*" + inline(c, skipLists).trim() + "*";
        else if (t === "CODE") out += "`" + c.textContent + "`";
        else if (t === "A") {
          const href = c.getAttribute("href") || "";
          const txt = inline(c, skipLists).trim();
          out += href ? `[${txt}](${abs(href)})` : txt;
        } else if (t === "IMG") {
          const src = c.getAttribute("src") || "";
          const alt = c.getAttribute("alt") || "";
          out += src ? `![${alt}](${abs(src)})` : "";
        } else out += inline(c, skipLists);
      }
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

  function svgName(svg) {
    if (svg.getAttribute("aria-hidden") === "true") return "";
    const title = svg.querySelector("title");
    return squash(svg.getAttribute("aria-label") || (title && title.textContent) || "");
  }

  // Site chrome: every <nav>, and any <header>/<footer> that is not an article's own
  // (an article header holds its title and byline).
  function isChrome(el, tag) {
    if (tag === "NAV") return true;
    if (tag !== "HEADER" && tag !== "FOOTER") return false;
    const p = el.parentElement;
    return !(p && p.closest("article,form,dialog,[role=dialog]"));
  }

  // A small search, sign-up or log-in form: no answer controls, nothing typed, little
  // text. Page UI, skipped as before. Big forms (a whole task page) are always walked.
  function isUiForm(form) {
    if (form.querySelector(ANSWER_CONTROLS)) return false;
    if ([...form.querySelectorAll("input")].some((i) => !NO_VALUE_INPUTS.has(i.type) && i.type !== "password" && i.value)) return false;
    return squash(form.textContent).length < 400;
  }

  function block(node, depth) {
    let md = "";
    node.childNodes.forEach((c) => {
      if (c.nodeType === 3) {
        const t = c.textContent.replace(/\s+/g, " ").trim();
        if (t) md += t + "\n\n";
        return;
      }
      if (c.nodeType !== 1 || done.has(c)) return;
      const tag = c.tagName.toUpperCase();
      if (SKIP.has(tag) || isChrome(c, tag) || (tag === "FORM" && isUiForm(c))) return;
      // Carousel libraries clone slides for looping; the originals are already walked.
      if (c.classList && (c.classList.contains("swiper-slide-duplicate") || c.classList.contains("slick-cloned"))) return;
      let kind;
      if (tag === "LABEL") {
        const t = labelText(c, false);
        if (t) md += t + "\n\n";
      } else if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
        const t = control(c, false);
        if (t) md += t + "\n\n";
      } else if ((kind = optionKind(c))) {
        md += optionLine(c, kind) + "\n\n";
      } else if (tag === "BUTTON") {
        // Plain action buttons ("Copy", "Submit") are UI. A long one is a clickable card.
        if (textOf(c).length > 60) md += block(c, depth);
      } else if (/^H[1-6]$/.test(tag)) {
        md += "#".repeat(+tag[1]) + " " + inline(c).trim() + "\n\n";
      } else if (tag === "P") {
        const t = inline(c).trim();
        if (t) md += t + "\n\n";
      } else if (tag === "UL" || tag === "OL") {
        // renderList walks descendant <li>s by nearest list ancestor (not direct
        // children), so it survives invalid markup like <ul><p><li>...</ul> AND
        // keeps nested sub-lists as properly indented sub-bullets.
        md += renderList(c, depth) + "\n";
      } else if (tag === "PRE") {
        md += stash(fence(c.textContent)) + "\n\n";
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

  // Walk one root to Markdown. skipEl (optional) is left out, for "everything else".
  function render(root, skipEl) {
    done = new Set(skipEl ? [skipEl] : []);
    tokens = [];
    groupCache = new Map();
    groups = new Map();
    stats = { radios: 0, picked: 0, groups: 0, unpicked: 0, checks: 0, checked: 0, selects: 0, texts: 0, filled: 0 };
    let md = block(root, 0).replace(/\n{3,}/g, "\n\n").trim();
    // Consecutive option lines sit on adjacent lines, so a group reads as one block.
    const isOpt = (l) => /^[(\[][x \-][)\]]( |$)/.test(l || "");
    const lines = md.split("\n");
    md = lines.filter((l, i) => !(l === "" && isOpt(lines[i - 1]) && isOpt(lines[i + 1]))).join("\n");
    md = md.replace(/\u0000(\d+)\u0000/g, (_, i) => tokens[+i]);
    stats.groups = groups.size;
    stats.unpicked = [...groups.values()].filter((v) => !v).length;
    return { md, stats };
  }

  // Content that shows one item at a time and may not be on the page at all.
  function hiddenPanelWarnings() {
    const out = new Set();
    const pager = /\b(item|slide|card|question|step|panel|rubric)\s*(\d+)\s*(?:of|\/)\s*(\d+)\b/i;
    const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
    let n, hits = 0;
    while ((n = walker.nextNode()) && hits < 500) {
      if (!/(^|\s|\d)(of|\/)\s*\d+\s*$|\d+\s*(of|\/)\s*\d+/i.test(n.textContent)) continue;
      hits++;
      // Climb a few levels so "item <input value=1> of 8", split across nodes, still matches.
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
        out.add(`${missing.length} of ${tabs.length} tabs (${missing.map(textOf).join(", ")}) have no panel on the page; their content is missing below. Open each tab and grab again.`);
      }
    });
    // Menus and pop-ups render on open too; only named sections in the content count.
    const shut = [...document.querySelectorAll("[aria-expanded=false][aria-controls]")]
      .filter((b) => !document.getElementById(b.getAttribute("aria-controls")) && !b.hasAttribute("aria-haspopup") &&
        !b.closest("nav,header,footer,[role=navigation],[role=banner],[role=menu],[role=menubar]") && textOf(b));
    if (shut.length) {
      out.add(`${shut.length} collapsed section(s) have no content on the page (${shut.slice(0, 5).map(textOf).join(", ")}); expand them and grab again.`);
    }
    return [...out];
  }

  const body = document.body || document.documentElement;
  if (!body) return { url: location.href, title: "", md: "", len: 0, stats: null, warnings: [] };

  // The main content goes first. Anything outside it with real prose (1,500+ characters
  // that are not link text, so menus and link lists don't count) or a filled-in text
  // area is appended, never dropped. Pages with no <main> (most task pages) use <body>.
  const main = document.querySelector("main") || document.querySelector("[role=main]") || document.querySelector("article");
  const first = render(main && main !== body ? main : body);
  let md = first.md;
  const counts = first.stats;
  if (main && main !== body) {
    const rest = render(body, main);
    const prose = squash(rest.md.replace(/!?\[[^\]]*\]\([^)]*\)/g, " ").replace(/^\s*(?:[-*]|\d+\.|#+)\s/gm, " ")).length;
    const typed = [...body.querySelectorAll("textarea")].some((t) => !main.contains(t) && !t.matches(EDITOR_HELPER) && t.value.trim());
    if (prose >= 1500 || typed) {
      md += "\n\n---\n<!-- outside the main content -->\n\n" + rest.md;
      for (const k in counts) counts[k] += rest.stats[k];
    }
  }
  return { url: location.href, title: document.title || "", md, len: md.length, stats: counts, warnings: hiddenPanelWarnings() };
}

function pad(n) { return String(n).padStart(2, "0"); }

function slugify(s) {
  return (s || "").toLowerCase().replace(/[^\w]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");
}

// <domain>_<short-title-slug>_<date>_<time>.md (short, readable, time always kept).
function buildName(url, title) {
  const u = new URL(url);
  const host = u.hostname.replace(/^www\./, "");
  let slug = slugify(title);
  if (!slug) slug = slugify(u.pathname.split("/").filter(Boolean).pop() || "");
  const d = new Date();
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
  return [host, slug, `${date}_${time}`].filter(Boolean).join("_") + ".md";
}

// UTF-8 text -> base64. A base64 data: URL is ~1.33x the text, where percent-encoding
// is up to 3x, which keeps big form captures under Chrome's 2 MB URL ceiling.
function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// One-line summary of the form state, so a reader sees the picks were captured.
function formSummary(frames) {
  const s = { radios: 0, picked: 0, groups: 0, unpicked: 0, checks: 0, checked: 0, selects: 0, texts: 0, filled: 0 };
  frames.forEach((f) => { if (f.stats) for (const k in s) s[k] += f.stats[k] || 0; });
  if (!s.radios && !s.checks && !s.selects && !s.texts) return "";
  const n = (k, one, many) => `${k} ${k === 1 ? one : many || one + "s"}`;
  const parts = [];
  if (s.radios) parts.push(`${n(s.radios, "choice option")} in ${n(s.groups, "group")} (${s.picked} picked, ${n(s.unpicked, "group")} with no pick)`);
  if (s.checks) parts.push(`${n(s.checks, "checkbox or toggle", "checkboxes and toggles")} (${s.checked} on)`);
  if (s.selects) parts.push(n(s.selects, "dropdown"));
  if (s.texts) parts.push(`${n(s.texts, "text field")} (${s.filled} filled)`);
  return parts.join(", ");
}

async function grab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return { ok: false, msg: "No active tab." };

  let results;
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: extractFrame,
    });
  } catch (e) {
    return { ok: false, msg: "Inject failed: " + e.message };
  }

  const seen = new Set();
  const ranked = results
    .map((r) => r && r.result)
    .filter((f) => f && f.len > 150 && !seen.has(f.md) && seen.add(f.md))
    .sort((a, b) => b.len - a.len);
  if (!ranked.length) return { ok: false, msg: "No content found on this page." };

  const best = ranked[0];
  // Keep the biggest frame first, then every other frame with real content (500+
  // chars) or a filled-in answer. Only small ad/widget frames are left out.
  const frames = [best, ...ranked.slice(1).filter((f) => f.len >= 500 ||
    (f.stats && f.stats.picked + f.stats.checked + f.stats.filled > 0))];

  const title = (tab.title || best.title || "Untitled").trim();
  const captured = new Date().toString();
  let body = `# ${title}\n\n> Source: ${tab.url}\n> Captured: ${captured}\n`;
  const form = formSummary(frames);
  if (form) body += `> Form: ${form}\n`;
  [...new Set(frames.flatMap((f) => f.warnings || []))].forEach((w) => { body += `> Warning: ${w}\n`; });
  body += `\n---\n\n`;
  body += frames
    .map((f, i) => (i === 0 ? f.md : `\n\n---\n<!-- frame: ${f.url} -->\n\n${f.md}`))
    .join("");

  const dataUrl = "data:text/markdown;charset=utf-8;base64," + toBase64(body);
  let id;
  try {
    id = await chrome.downloads.download({
      url: dataUrl,
      filename: `monkgrab/${buildName(tab.url, title)}`,
      conflictAction: "uniquify",
      saveAs: false,
    });
  } catch (e) {
    return { ok: false, msg: "Download failed: " + e.message };
  }
  const error = await downloadError(id);
  if (error) return { ok: false, msg: "Download failed: " + (DOWNLOAD_ERRORS[error] || error) + ` (${error})` };
  return { ok: true, msg: `Downloaded .md (${frames.length} frame(s), ${best.len} chars).` };
}

const DOWNLOAD_ERRORS = {
  FILE_ACCESS_DENIED: "Chrome can't write to the downloads folder. Check Settings > Downloads > Location, and that the folder exists and is writable",
  FILE_NO_SPACE: "the disk is full",
  FILE_NAME_TOO_LONG: "the file name is too long for this disk",
  FILE_TOO_LARGE: "the file is too large for this disk",
  FILE_BLOCKED: "downloads are blocked by Chrome settings or a policy",
  FILE_VIRUS_INFECTED: "the virus scanner blocked the file",
  FILE_SECURITY_CHECK_FAILED: "a security check blocked the file",
  FILE_FAILED: "Chrome could not save the file",
  // Also what Chrome reports when the downloads folder is missing or read-only.
  USER_CANCELED: "Chrome cancelled the save. Check that the downloads folder in Settings > Downloads > Location exists and is writable",
};

// chrome.downloads.download() resolves once the download STARTS. A folder Chrome can't
// write to, a full disk or a policy block only shows up after that, as an "interrupted"
// state. Wait for the end state so a failed save is never reported as a success.
// Returns null when the file was written, else Chrome's error code.
function downloadError(id, ms = 15000) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.downloads.onChanged.removeListener(onChanged);
      resolve(err);
    };
    const check = (state, error) => {
      if (state === "complete") finish(null);
      else if (state === "interrupted") finish(error || "FILE_FAILED");
    };
    const onChanged = (d) => {
      if (d.id === id && d.state) check(d.state.current, d.error && d.error.current);
    };
    // A save still running after 15 s is slow, not failed: report success, as before.
    const timer = setTimeout(() => finish(null), ms);
    chrome.downloads.onChanged.addListener(onChanged);
    // It may already be over before the listener was added.
    chrome.downloads.search({ id }).then(([item]) => item && check(item.state, item.error), () => {});
  });
}

const DEFAULT_TITLE = (chrome.runtime && chrome.runtime.getManifest().action.default_title) || "MonkGrab";

// Badge feedback since there's no popup: ✓ for 2 s on success. On failure the ! stays,
// and hovering the icon shows the reason, until the next grab.
async function flash(res) {
  if (!res.ok) console.error("MonkGrab:", res.msg);
  await chrome.action.setBadgeBackgroundColor({ color: res.ok ? "#14b8a6" : "#dc2626" });
  await chrome.action.setBadgeText({ text: res.ok ? "✓" : "!" });
  await chrome.action.setTitle({ title: res.ok ? DEFAULT_TITLE : "MonkGrab could not save this page. " + res.msg });
  if (res.ok) setTimeout(() => chrome.action.setBadgeText({ text: "" }), 2000);
}

// Click the toolbar icon -> grab + download immediately.
chrome.action.onClicked.addListener(async () => flash(await grab()));

// Hotkey (⌘⇧G) -> same.
chrome.commands.onCommand.addListener(async (cmd) => {
  if (cmd === "grab") flash(await grab());
});
