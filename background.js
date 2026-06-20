// MonkGrab — webpage to Markdown — service worker.
// Injects into EVERY frame of the active tab (allFrames bypasses the cross-origin
// iframe wall, since the function runs inside each frame's own context), converts
// each content frame's DOM to Markdown right there, then downloads ONE .md file
// named <domain>_<path>_<datetime>.md. No external tools, no second step.

// Runs inside each frame. Self-contained (serialized by chrome.scripting) DOM ->
// Markdown walker. Returns this frame's markdown + a length to rank frames by.
function extractFrame() {
  const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "NAV", "HEADER", "FOOTER", "SVG", "BUTTON", "FORM", "IFRAME"]);

  // Resolve relative href/src to absolute against this frame's URL, so links and
  // images still work once the .md is saved off-site. Falls back to the raw value.
  function abs(u) {
    try { return new URL(u, location.href).href; } catch (_) { return u; }
  }

  function inline(node) {
    let out = "";
    node.childNodes.forEach((c) => {
      if (c.nodeType === 3) out += c.textContent.replace(/\s+/g, " ");
      else if (c.nodeType === 1) {
        // SVG and other non-HTML elements report a case-sensitive tagName; normalize.
        const t = c.tagName.toUpperCase();
        if (t === "BR") out += "\n";
        else if (t === "STRONG" || t === "B") out += "**" + inline(c).trim() + "**";
        else if (t === "EM" || t === "I") out += "*" + inline(c).trim() + "*";
        else if (t === "CODE") out += "`" + c.textContent + "`";
        else if (t === "A") {
          const href = c.getAttribute("href") || "";
          const txt = inline(c).trim();
          out += href ? `[${txt}](${abs(href)})` : txt;
        } else if (t === "IMG") {
          const src = c.getAttribute("src") || "";
          const alt = c.getAttribute("alt") || "";
          out += src ? `![${alt}](${abs(src)})` : "";
        } else out += inline(c);
      }
    });
    return out;
  }

  // Render a <ul>/<ol> and its nested sub-lists as indented Markdown bullets.
  // Robust to invalid markup (e.g. <ul><p><li>...</ul>): list membership is decided
  // by each <li>'s nearest list ancestor, and a clone with nested lists stripped
  // gives the item's own text, so nested items never collapse into their parent line.
  function renderList(list, baseDepth) {
    let out = "";
    const counters = new Map();
    list.querySelectorAll("li").forEach((li) => {
      const owner = li.closest("ul,ol");
      if (!owner || !list.contains(owner)) return;
      let depthN = 0, a = owner;
      while (a && a !== list) { if (a.tagName === "UL" || a.tagName === "OL") depthN++; a = a.parentElement; }
      let mark;
      if (owner.tagName === "OL") { const n = (counters.get(owner) || 0) + 1; counters.set(owner, n); mark = n + ". "; }
      else mark = "- ";
      const clone = li.cloneNode(true);
      clone.querySelectorAll("ul,ol").forEach((n) => n.remove());
      const line = inline(clone).replace(/\s+/g, " ").trim();
      if (line) out += "  ".repeat(baseDepth + depthN) + mark + line + "\n";
    });
    return out;
  }

  function block(node, depth) {
    let md = "";
    node.childNodes.forEach((c) => {
      if (c.nodeType === 3) {
        const t = c.textContent.replace(/\s+/g, " ").trim();
        if (t) md += t + "\n\n";
        return;
      }
      if (c.nodeType !== 1) return;
      const tag = c.tagName.toUpperCase();
      if (SKIP.has(tag)) return;
      if (/^H[1-6]$/.test(tag)) {
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
        md += "```\n" + c.textContent.replace(/\n+$/, "") + "\n```\n\n";
      } else if (tag === "BLOCKQUOTE") {
        md += "> " + inline(c).trim().replace(/\n/g, "\n> ") + "\n\n";
      } else if (tag === "HR") {
        md += "---\n\n";
      } else if (tag === "IMG") {
        md += inline(c) + "\n\n";
      } else {
        md += block(c, depth); // descend into divs/sections/etc.
      }
    });
    return md;
  }

  const root =
    document.querySelector("main") ||
    document.querySelector("[role=main]") ||
    document.querySelector("article") ||
    document.body ||
    document.documentElement;
  const md = root ? block(root, 0).replace(/\n{3,}/g, "\n\n").trim() : "";
  return { url: location.href, title: document.title || "", md, len: md.length };
}

function pad(n) { return String(n).padStart(2, "0"); }

function slugify(s) {
  return (s || "").toLowerCase().replace(/[^\w]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");
}

// <domain>_<short-title-slug>_<date>_<time>.md — short, readable, time always kept.
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

  const ranked = results
    .map((r) => r.result)
    .filter((f) => f && f.len > 150)
    .sort((a, b) => b.len - a.len);
  if (!ranked.length) return { ok: false, msg: "No content found on this page." };

  const best = ranked[0];
  // Keep the main frame, plus any secondary frame substantial enough to be real
  // content (not an ad/widget): at least 500 chars AND >=15% of the main frame.
  // This is what actually "drops nav/chrome/widgets".
  const floor = Math.max(500, Math.round(best.len * 0.15));
  const frames = [best, ...ranked.slice(1).filter((f) => f.len >= floor)];

  const title = (tab.title || best.title || "Untitled").trim();
  const captured = new Date().toString();
  let body = `# ${title}\n\n> Source: ${tab.url}\n> Captured: ${captured}\n\n---\n\n`;
  body += frames
    .map((f, i) => (i === 0 ? f.md : `\n\n---\n<!-- frame: ${f.url} -->\n\n${f.md}`))
    .join("");

  const dataUrl = "data:text/markdown;charset=utf-8," + encodeURIComponent(body);
  try {
    await chrome.downloads.download({
      url: dataUrl,
      filename: `monkgrab/${buildName(tab.url, title)}`,
      conflictAction: "uniquify",
      saveAs: false,
    });
  } catch (e) {
    return { ok: false, msg: "Download failed: " + e.message };
  }
  return { ok: true, msg: `Downloaded .md (${frames.length} frame(s), ${best.len} chars).` };
}

// Brief badge feedback since there's no popup: ✓ on success, ! on failure.
async function flash(res) {
  await chrome.action.setBadgeBackgroundColor({ color: res.ok ? "#14b8a6" : "#dc2626" });
  await chrome.action.setBadgeText({ text: res.ok ? "✓" : "!" });
  setTimeout(() => chrome.action.setBadgeText({ text: "" }), 2000);
}

// Click the toolbar icon -> grab + download immediately.
chrome.action.onClicked.addListener(async () => flash(await grab()));

// Hotkey (⌘⇧G) -> same.
chrome.commands.onCommand.addListener(async (cmd) => {
  if (cmd === "grab") flash(await grab());
});
