#!/usr/bin/env node
// MonkGrab regression check: old converter vs current converter on real pages.
//
// Opens each URL once in headless Chrome (agent-browser), runs the extractFrame() from
// an older commit and the current one on the same live page, and reports what changed:
// lines the old output had that the new one lost (possible regressions), and lines the
// new one added. Both outputs are saved so the diff can be read in full.
//
//   node test/compare.mjs                         # default page list, base = 1.0.1
//   node test/compare.mjs https://a.test/x ...    # your own pages
//   BASE=<commit> OUT=/tmp/mg-compare node test/compare.mjs
//
// A lost line is not always a bug (the new output may hold the same text in a different
// shape), so read the "lost" list, not just the count.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");
const base = process.env.BASE || "b837001"; // last 1.0.1 commit
const outDir = process.env.OUT || fs.mkdtempSync(path.join(os.tmpdir(), "monkgrab-compare-"));
fs.mkdirSync(outDir, { recursive: true });

const grabFn = (src) => src.match(/^function extractFrame\(\) \{[\s\S]*?^\}$/m)[0];
const oldSrc = grabFn(execFileSync("git", ["show", `${base}:background.js`], { cwd: repo, encoding: "utf8" }));
const newSrc = grabFn(fs.readFileSync(path.join(repo, "background.js"), "utf8"));

const PAGES = process.argv.slice(2).length ? process.argv.slice(2) : [
  "https://en.wikipedia.org/wiki/Markdown",
  "https://developer.mozilla.org/en-US/docs/Web/HTML/Element/details",
  "https://github.com/monkfromearth/monkgrab",
  "https://paulgraham.com/greatwork.html",
  "https://news.ycombinator.com/",
  "https://news.ycombinator.com/item?id=8863",
  "https://docs.python.org/3/library/re.html",
  "https://react.dev/learn",
  "https://www.bbc.com/news",
  "https://dev.to/",
  "https://arxiv.org/abs/1706.03762",
  "https://old.reddit.com/r/programming/",
  "https://tailwindcss.com/docs/installation",
  "https://monkfrom.earth/",
  "https://blog.pragmaticengineer.com/",
  "https://stackoverflow.com/questions/11227809",
];

const ab = (...args) => execFileSync("agent-browser", args, { encoding: "utf8", maxBuffer: 512 * 1024 * 1024, timeout: 90000 });
const norm = (l) => l.replace(/\s+/g, " ").trim();

let i = 0, compared = 0;
for (const url of PAGES) {
  i++;
  const slug = String(i).padStart(2, "0") + "-" + new URL(url).hostname.replace(/^www\./, "");
  try {
    ab("open", url);
    try { ab("wait", "1500"); } catch (_) {}
    const js = `JSON.stringify({ old: (${oldSrc})(), now: (${newSrc})() })`;
    let r = JSON.parse(ab("eval", js).trim());
    if (typeof r === "string") r = JSON.parse(r);
    fs.writeFileSync(path.join(outDir, slug + ".old.md"), r.old.md);
    compared++;
    fs.writeFileSync(path.join(outDir, slug + ".new.md"), r.now.md);
    const oldLines = r.old.md.split("\n").map(norm).filter(Boolean);
    const newSet = new Set(r.now.md.split("\n").map(norm));
    const newText = norm(r.now.md);
    // Lost = an old line whose text is nowhere in the new output, even reshaped.
    const lost = oldLines.filter((l) => !newSet.has(l) && !newText.includes(l));
    const oldSet = new Set(oldLines);
    const added = r.now.md.split("\n").map(norm).filter((l) => l && !oldSet.has(l));
    const s = r.now.stats || {};
    console.log(`\n${slug}  old ${r.old.len} chars -> new ${r.now.len} chars (${r.old.len ? Math.round((100 * r.now.len) / r.old.len) : "-"}%)`);
    console.log(`  form: radios ${s.radios || 0}, checks ${s.checks || 0}, selects ${s.selects || 0}, texts ${s.texts || 0}`);
    r.now.warnings.forEach((w) => console.log("  warning: " + w.slice(0, 140)));
    console.log(`  lost ${lost.length} lines, added ${added.length} lines`);
    lost.slice(0, 8).forEach((l) => console.log("    - " + l.slice(0, 140)));
    added.slice(0, 8).forEach((l) => console.log("    + " + l.slice(0, 140)));
  } catch (e) {
    console.log(`\n${slug}  SKIPPED (${String(e.message).split("\n")[0].slice(0, 120)})`);
  }
}
try { execFileSync("agent-browser", ["close"], { stdio: "ignore" }); } catch (_) {}
console.log(`\ncompared ${compared} of ${PAGES.length} pages; outputs in ${outDir}`);
// Sites that fail to load are skipped, but a run that compared nothing is a failure.
if (!compared) process.exit(1);
