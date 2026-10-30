#!/usr/bin/env node
// MonkGrab test runner.
//
// 1. Opens each page in headless Chrome (via the agent-browser CLI) and runs the real
//    extractFrame() from background.js inside it, plus a "truth" probe that reads the
//    live state of every native radio, checkbox, select and textarea.
// 2. Runs the real grab() from background.js in a Node sandbox with a fake chrome API,
//    so frame selection, the header and the base64 download are tested too.
// 3. Checks the downloaded Markdown: expected lines for the bundled test pages, and a
//    live-state cross-check (every pick, every textarea value) for every page.
//
//   node test/run.mjs                    # bundled test pages
//   node test/run.mjs saved-page.html    # also cross-check any saved page
//   OUT=/tmp/mg node test/run.mjs        # keep the .md outputs in /tmp/mg
//
// Needs Node 18+ and agent-browser (https://github.com/vercel-labs/agent-browser).

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, "..", "background.js"), "utf8");
const fnOf = (code) => code.match(/^function extractFrame\(\) \{[\s\S]*?^\}$/m)[0];
const extractSrc = fnOf(src);
// The 1.0.1 converter, for the "ordinary pages are unchanged" check.
const BASE = process.env.BASE || "b837001";
let baseSrc = null;
try { baseSrc = fnOf(execFileSync("git", ["show", `${BASE}:background.js`], { cwd: path.join(here, ".."), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })); } catch (_) {}
const outDir = process.env.OUT || "";
if (outDir) fs.mkdirSync(outDir, { recursive: true });

// Live state of native controls, read in the page. Used to cross-check the output.
function liveTruth() {
  const sq = (s) => (s || "").replace(/\s+/g, "");
  // Skip mirror inputs and site chrome (every nav, page-level header/footer), which the
  // converter leaves out on purpose.
  const chrome = (el) => {
    if (el.closest("nav")) return true;
    const h = el.closest("header,footer");
    return !!h && !(h.parentElement && h.parentElement.closest("article,form,dialog,[role=dialog]"));
  };
  const real = (el) => el.getAttribute("aria-hidden") !== "true" && !chrome(el);
  const lbl = (el) => (el.labels && el.labels[0] ? sq(el.labels[0].textContent) : null);
  return {
    radios: [...document.querySelectorAll("input[type=radio]")].filter(real).map((r) => ({ st: r.checked ? "x" : " ", label: lbl(r) })),
    checks: [...document.querySelectorAll("input[type=checkbox]")].filter(real)
      .map((c) => ({ st: c.indeterminate ? "-" : c.checked ? "x" : " ", label: lbl(c) })),
    selects: [...document.querySelectorAll("select")].filter(real)
      .map((s) => [...s.selectedOptions].map((o) => o.textContent.replace(/\s+/g, " ").trim()).join("; ") || "(none)"),
    textareas: [...document.querySelectorAll("textarea")]
      .filter((t) => real(t) && !t.matches(".inputarea, .monaco-editor textarea, .CodeMirror textarea"))
      .map((t) => t.value),
  };
}

function browserRun(file) {
  const ab = (...args) => execFileSync("agent-browser", args, { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
  ab("open", pathToFileURL(file).href);
  const old = baseSrc ? `(${baseSrc})()` : "null";
  const js = `JSON.stringify({ frame: (${extractSrc})(), truth: (${liveTruth.toString()})(), old: ${old}, url: location.href, title: document.title })`;
  const t0 = Date.now();
  let out = JSON.parse(ab("eval", js).trim());
  if (typeof out === "string") out = JSON.parse(out);
  out.ms = Date.now() - t0;
  return out;
}

// A fake chrome API around background.js. endState is what the download ends as:
// "complete", or an interrupt reason such as "FILE_ACCESS_DENIED" (reported late,
// through downloads.onChanged, the way Chrome does it).
function sandbox(frames, url, title, endState = "complete") {
  const box = { download: null, badge: "", title: "" };
  const noop = { addListener() {} };
  const changed = new Set();
  const chrome = {
    tabs: { query: async () => [{ id: 1, url, title }] },
    scripting: { executeScript: async () => frames.map((result, frameId) => ({ frameId, result })) },
    downloads: {
      download: async (o) => {
        box.download = o;
        setTimeout(() => changed.forEach((f) => f(endState === "complete"
          ? { id: 7, state: { current: "complete" } }
          : { id: 7, state: { current: "interrupted" }, error: { current: endState } })), 20);
        return 7;
      },
      search: async () => [{ id: 7, state: "in_progress" }],
      onChanged: { addListener: (f) => changed.add(f), removeListener: (f) => changed.delete(f) },
    },
    action: {
      onClicked: noop,
      setBadgeBackgroundColor: async () => {},
      setBadgeText: async (o) => { box.badge = o.text; },
      setTitle: async (o) => { box.title = o.title; },
    },
    commands: { onCommand: noop },
    runtime: { getManifest: () => JSON.parse(fs.readFileSync(path.join(here, "..", "manifest.json"), "utf8")) },
  };
  box.ctx = vm.createContext({ chrome, TextEncoder, btoa, URL, Date, console: { ...console, error() {} }, setTimeout, clearTimeout });
  vm.runInContext(src, box.ctx);
  return box;
}

// Run background.js's grab() with a fake chrome API; returns the decoded .md text.
async function sandboxGrab(frames, url, title) {
  const box = sandbox(frames, url, title);
  const res = await vm.runInContext("grab()", box.ctx);
  if (!res.ok) throw new Error("grab() failed: " + res.msg);
  const [meta, b64] = box.download.url.split(",");
  if (!meta.endsWith(";base64")) throw new Error("download is not a base64 data URL");
  return { md: Buffer.from(b64, "base64").toString("utf8"), res, download: box.download };
}

// A download Chrome accepts and then fails (unwritable folder) must not show ✓.
async function testDownloadErrors() {
  console.log("\ndownload errors (sandbox)");
  const frame = { url: "https://x.test/", title: "", md: "Body text. ".repeat(40), len: 440, stats: null, warnings: [] };
  const bad = sandbox([frame], "https://x.test/", "T", "FILE_ACCESS_DENIED");
  const res = await vm.runInContext("grab().then(async (r) => { await flash(r); return r; })", bad.ctx);
  check("late FILE_ACCESS_DENIED reported as a failure", res.ok === false && /FILE_ACCESS_DENIED/.test(res.msg), res.msg);
  check("failure message says what to check", /downloads folder/.test(res.msg), res.msg);
  check("! badge stays after a failure", bad.badge === "!");
  await new Promise((r) => setTimeout(r, 2100));
  check("! badge still there after 2 s", bad.badge === "!");
  check("icon tooltip gives the reason", /could not save/.test(bad.title) && /FILE_ACCESS_DENIED/.test(bad.title), bad.title);
  const good = sandbox([frame], "https://x.test/", "T");
  const ok = await vm.runInContext("grab().then(async (r) => { await flash(r); return r; })", good.ctx);
  check("completed download reported as a success", ok.ok === true, ok.msg);
  check("tooltip back to the default after a success", good.title === "MonkGrab: save page as Markdown", good.title);
}

let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? "\n        " + detail : ""}`);
}

// Every live pick and every textarea value must be in the output, with the right marker.
function crossCheck(md, truth) {
  const lines = md.split("\n").map((l) => l.replace(/^\s*(?:- |\d+\. )/, ""));
  const count = (re) => {
    const bag = new Map();
    lines.forEach((l) => { const m = l.match(re); if (m) { const k = m[1] + "|" + m[2].replace(/\s+/g, ""); bag.set(k, (bag.get(k) || 0) + 1); } });
    return bag;
  };
  const radioBag = count(/^\(([x \-])\) ?(.*)$/);
  const checkBag = count(/^\[([x \-])\] ?(.*)$/);
  const missing = (items, bag) => {
    const need = new Map();
    items.filter((i) => i.label !== null).forEach((i) => { const k = i.st + "|" + i.label; need.set(k, (need.get(k) || 0) + 1); });
    return [...need].filter(([k, n]) => (bag.get(k) || 0) < n).map(([k, n]) => `${n}x "${k}" (found ${bag.get(k) || 0})`);
  };
  const r = missing(truth.radios, radioBag);
  check(`all ${truth.radios.length} radios marked with live state (${truth.radios.filter((x) => x.st === "x").length} picked)`, !r.length, r.slice(0, 5).join("; "));
  const c = missing(truth.checks, checkBag);
  check(`all ${truth.checks.length} checkboxes marked with live state (${truth.checks.filter((x) => x.st === "x").length} checked)`, !c.length, c.slice(0, 5).join("; "));
  const s = truth.selects.filter((v) => !md.includes("Selected: " + v));
  check(`all ${truth.selects.length} selects show "Selected: <live value>"`, !s.length, s.join("; "));
  const filled = truth.textareas.filter((v) => v.trim());
  const t = filled.filter((v) => !md.includes(v.replace(/\n+$/, "")));
  check(`all ${filled.length} filled textareas present in full (longest ${Math.max(0, ...filled.map((v) => v.length))} chars)`, !t.length,
    t.slice(0, 3).map((v) => JSON.stringify(v.slice(0, 80))).join("; "));
}

const hasLine = (md, line) => md.split("\n").some((l) => l === line);

const EXPECT = {
  "form-state.html": {
    lines: [
      "(x) FAIL", "( ) PASS", "( ) PARTIAL",
      "( ) Must have", "(x) Nice to have",
      "( ) Left blank A", "( ) Left blank B",
      "( ) Good", "( ) Okay", "(x) Bad",
      "( ) 1", "( ) 2", "(x) 3",
      "( ) Low", "( ) Medium", "(x) High",
      "( ) Yes", "(x) No",
      "[x] List", "[ ] Table", "[ ] Carousel",
      "[ ] Ran the tests", "[x] Ran the linter", "[-] Some files reviewed",
      "[x] Custom checkbox", "[x] Email alerts", "[x] Two-part label",
      "Selected: High (options: Low | Medium | High)",
      "Selected: alpha; gamma (options: alpha | beta | gamma)",
      "Value: Doc", "Value: 4", "Value: (empty)",
      "- [x] Task-list item done", "- [ ] Task-list item open",
      "(x) Overview", "( ) Details", "( ) History",
      "( ) Rating low", "(x) Rating high",
    ],
    has: [
      "Read the two trajectories, then rate each dimension. The instructions block must survive.",
      "Rubric item one", "Rubric item two", "Rubric item three",
      "Details panel text, hidden but in the page.", "Collapsed section text.",
      "Is providing grep for the correctness command valid?",
      "Optional note\n\nValue: (empty)",
      '> Warning: "Currently viewing item 1 of 3"',
      "> Warning: 1 of 3 tabs (History) have no panel on the page",
      "> Form: 20 choice options in 8 groups (7 picked, 1 group with no pick), 11 checkboxes and toggles (6 on), 2 dropdowns, 6 text fields (5 filled)",
      "\n````\nTrajectory A is stronger.\n\nThe agent read",
      "```py\nretry(3)\n```\n\nEND-OF-REVIEW\n````",
    ],
    not: ["SECRET-TOKEN", "EDITOR-HELPER", "Footer links", "Search files", "Toggle", "\n[x]\n", "original text from the HTML", "old name", "Like this post", "LEAKED-INTO-NAME", "PW-SHOULD-NOT-APPEAR"],
    once: ["Email alerts", "Review Comment", "Must have"],
  },
  "ordinary-page.html": {
    lines: ["## Daily Paper", "# Article title from the article header", "- List item two"],
    has: ["ARTICLE-BODY-MARKER", "LAST-PARAGRAPH-MARKER", "\nHot\n", "```\nconst a = 1;\n\nconst b = 2;\n```"],
    not: ["> Form:", "> Warning:", "Value:", "(x)", "[x]", "[ ]", "( )", "Search", "Menu", "Section A", "Subscribe",
      "newsletter", "comment", "Like", "Follow", "Bookmark", "Another story", "outside the main content", "Footer text"],
    // Same as 1.0.1, except the article's own <header>, which 1.0.1 dropped.
    sameAsBase: ["# Article title from the article header", "By Doc, 30 October 2026"],
  },
  "main-plus-aside.html": {
    lines: ["# Article title"],
    has: ["MAIN-CONTENT-MARKER", "OUTSIDE-BLOCK-MARKER", "<!-- outside the main content -->"],
    not: ["> Form:"],
  },
};

async function testPage(file) {
  const name = path.basename(file);
  console.log(`\n${name}`);
  const run = browserRun(file);
  const { md } = await sandboxGrab([run.frame], run.url, run.title);
  if (outDir) fs.writeFileSync(path.join(outDir, name.replace(/\.html?$/, "") + ".md"), md);
  console.log(`  ${md.length} chars of Markdown, extract took ${run.ms} ms`);
  const exp = EXPECT[name];
  if (exp) {
    const badLines = (exp.lines || []).filter((l) => !hasLine(md, l));
    check(`${(exp.lines || []).length} expected lines present`, !badLines.length, badLines.join(" | "));
    const badHas = (exp.has || []).filter((s) => !md.includes(s));
    check(`${(exp.has || []).length} expected passages present`, !badHas.length, badHas.join(" | "));
    const badNot = (exp.not || []).filter((s) => md.includes(s));
    check(`${(exp.not || []).length} unwanted strings absent`, !badNot.length, badNot.join(" | "));
    const badOnce = (exp.once || []).filter((s) => md.split(s).length !== 2);
    check(`${(exp.once || []).length} labels printed exactly once`, !badOnce.length, badOnce.join(" | "));
    if (exp.sameAsBase && !run.old) console.log(`  SKIP  same-as-${BASE} check (git history not available)`);
    else if (exp.sameAsBase) {
      const lines = (t) => t.split("\n").map((l) => l.trim()).filter(Boolean);
      const now = lines(run.frame.md), before = lines(run.old.md);
      const lost = before.filter((l) => !now.includes(l));
      const added = now.filter((l) => !before.includes(l) && !exp.sameAsBase.includes(l));
      check(`output matches ${BASE} (1.0.1) apart from ${exp.sameAsBase.length} expected new lines`, !lost.length && !added.length,
        [...lost.map((l) => "lost: " + l), ...added.map((l) => "added: " + l)].join(" | "));
    }
  }
  crossCheck(md, run.truth);
}

// Frame selection: the old 15%-of-main rule dropped a 700-char frame next to a big
// one. Now every frame with 500+ chars is kept, duplicates collapse, tiny ones go.
async function testFrames() {
  console.log("\nframe selection (sandbox)");
  const f = (md, extra = {}) => ({ url: "https://x.test/" + md.length, title: "", md, len: md.length, stats: null, warnings: [], ...extra });
  const big = f("BIG ".repeat(5000));
  const mid = f("MID-FRAME ".repeat(70));
  const tiny = f("TINY-AD ".repeat(30));
  const { md } = await sandboxGrab([tiny, big, mid, { ...mid }, null], "https://x.test/page", "Frames");
  check("big frame kept first", md.indexOf("BIG") < md.indexOf("MID-FRAME"));
  check("700-char frame kept (was dropped by the 15% rule)", md.includes("MID-FRAME"));
  check("duplicate frame printed once", md.split("<!-- frame:").length === 2);
  check("240-char ad frame dropped", !md.includes("TINY-AD"));
  const answered = f("Short form ".repeat(20), { stats: { radios: 2, picked: 1, groups: 1, unpicked: 0, checks: 0, checked: 0, selects: 0, texts: 0, filled: 0 } });
  const r2 = await sandboxGrab([big, answered], "https://x.test/page", "Frames");
  check("small frame with a picked answer kept", r2.md.includes("Short form"));
  const uni = await sandboxGrab([f("Unicode check: café, 日本語, emoji 🤖, quote ’. ".repeat(10))], "https://x.test/u", "Ü");
  check("UTF-8 survives the base64 download", uni.md.includes("café, 日本語, emoji 🤖"));
}

const pages = [path.join(here, "form-state.html"), path.join(here, "ordinary-page.html"), path.join(here, "main-plus-aside.html"), ...process.argv.slice(2).map((p) => path.resolve(p))];
for (const p of pages) await testPage(p);
await testFrames();
await testDownloadErrors();
try { execFileSync("agent-browser", ["close"], { stdio: "ignore" }); } catch (_) {}
console.log(`\n${failures ? failures + " check(s) FAILED" : "All checks passed"}`);
process.exit(failures ? 1 : 0);
