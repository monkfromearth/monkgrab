// Where the tests get the converter: the current extract.js, or the version at a git
// commit. Both come back as source text that declares extractFrame(); run it in a page
// with withExtract(source, "extractFrame()").

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function currentConverter() {
  return fs.readFileSync(path.join(root, "extract.js"), "utf8");
}

// The converter at a commit, or null if git history is not available. Up to 1.0.1 it
// lived inside background.js, next to chrome.* calls a page can't run, so only the
// function is cut out there.
export function converterAt(ref) {
  const show = (file) => execFileSync("git", ["show", `${ref}:${file}`], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  try { return show("extract.js"); } catch (_) {}
  try { return show("background.js").match(/^function extractFrame\(\) \{[\s\S]*?^\}$/m)[0]; } catch (_) { return null; }
}

// A page-side expression that declares the converter, then evaluates expr.
export function withExtract(source, expr) {
  return `(() => {\n${source}\nreturn ${expr};\n})()`;
}
