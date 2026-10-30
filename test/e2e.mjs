#!/usr/bin/env node
// MonkGrab end-to-end test: the real extension in a real browser.
//
// Launches Chrome for Testing / Chromium with the unpacked extension loaded, opens a
// page, calls grab() inside the extension's own service worker (the same function the
// toolbar click runs), and waits for the .md file Chrome actually downloads. Then makes
// the downloads folder read-only and checks that a failed save shows the ! badge and
// the reason, instead of a false ✓.
//
//   CHROME="/path/to/Chromium" node --experimental-websocket test/e2e.mjs [page.html]
//
// Branded Google Chrome ignores --load-extension, so point CHROME at Chrome for
// Testing or Chromium (e.g. the one Playwright installs). Node 22+ does not need the
// --experimental-websocket flag.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ext = path.resolve(here, "..");
const page = path.resolve(process.argv[2] || path.join(here, "form-state.html"));
const chromePath = process.env.CHROME;
if (!chromePath) { console.error("Set CHROME to a Chrome for Testing or Chromium binary."); process.exit(2); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "monkgrab-e2e-"));
const profile = path.join(tmp, "profile");
const downloads = path.join(tmp, "downloads");
fs.mkdirSync(path.join(profile, "Default"), { recursive: true });
fs.mkdirSync(downloads);
fs.writeFileSync(path.join(profile, "Default", "Preferences"),
  JSON.stringify({ download: { default_directory: downloads, prompt_for_download: false } }));

const port = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn(chromePath, [
  "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  `--disable-extensions-except=${ext}`, `--load-extension=${ext}`,
  // Without the mock keychain, Chrome on macOS hangs at start waiting for keychain access.
  "--use-mock-keychain", "--password-store=basic",
  "--no-first-run", "--no-default-browser-check", pathToFileURL(page).href,
], { stdio: "ignore", detached: true });

// Kill Chrome and all its helper processes (its own process group) however this
// script ends: normal exit, Ctrl+C, or a timeout's SIGTERM. Otherwise a headless
// Chrome is left running in the background.
function killChrome() {
  try { process.kill(-chrome.pid, "SIGKILL"); } catch (_) {}
}
process.on("exit", killChrome);
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => { killChrome(); process.exit(130); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, what, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn().catch(() => null); if (v) return v; await sleep(200); }
  throw new Error("timed out waiting for " + what);
}

// Minimal CDP client over one WebSocket.
function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  const ready = new Promise((r) => (ws.onopen = r));
  return {
    ready,
    send: (method, params = {}) => new Promise((resolve, reject) => {
      const n = ++id;
      pending.set(n, (msg) => (msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)));
      ws.send(JSON.stringify({ id: n, method, params }));
    }),
    close: () => ws.close(),
  };
}

let code = 1;
try {
  const targets = () => fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
  const worker = await until(async () => (await targets()).find((t) => t.type === "service_worker" && t.url.endsWith("/background.js")), "the extension service worker");
  await until(async () => (await targets()).find((t) => t.type === "page" && t.url.startsWith("file:")), "the test page");
  await sleep(500); // let the page's own script finish its after-load edits

  const sw = cdp(worker.webSocketDebuggerUrl);
  await sw.ready;
  // The same steps as a toolbar click: grab(), then flash() the badge.
  const click = () => sw.send("Runtime.evaluate", {
    expression: `(async () => { const r = await grab(); await flash(r);
      return { ...r, badge: await chrome.action.getBadgeText({}), title: await chrome.action.getTitle({}) }; })()`,
    awaitPromise: true, returnByValue: true,
  }).then((x) => x.result.value);
  const r = await click();
  console.log("grab() returned:", JSON.stringify(r));

  const file = await until(async () => {
    const dir = path.join(downloads, "monkgrab");
    const f = fs.existsSync(dir) && fs.readdirSync(dir).find((n) => n.endsWith(".md"));
    return f ? path.join(dir, f) : null;
  }, "the downloaded .md file");
  const md = fs.readFileSync(file, "utf8");
  console.log(`downloaded ${file} (${md.length} chars)`);
  const checks = ["(x) FAIL", "( ) PASS", "[x] Ran the linter", "Selected: High", "END-OF-REVIEW", "> Form: ", "Is providing grep"];
  const missing = path.basename(page) === "form-state.html" ? checks.filter((c) => !md.includes(c)) : [];
  console.log(missing.length ? "FAIL missing: " + missing.join(" | ") : "PASS real extension downloaded the expected Markdown");

  // A folder Chrome can't write to: download() still resolves, the save fails later.
  fs.chmodSync(path.join(downloads, "monkgrab"), 0o555);
  fs.chmodSync(downloads, 0o555);
  const bad = await click();
  sw.close();
  fs.chmodSync(downloads, 0o755);
  fs.chmodSync(path.join(downloads, "monkgrab"), 0o755);
  console.log("grab() into a read-only folder returned:", JSON.stringify(bad));
  const files = fs.readdirSync(path.join(downloads, "monkgrab")).filter((n) => n.endsWith(".md")).length;
  const failOk = bad.ok === false && bad.badge === "!" && /could not save/.test(bad.title) && files === 1;
  console.log(failOk ? "PASS failed save shows ! and the reason" : "FAIL failed save was not reported");
  code = r.ok && r.badge === "✓" && !missing.length && failOk ? 0 : 1;
  if (process.env.KEEP) console.log("kept files in", tmp);
} catch (e) {
  console.error("FAIL", e.message);
} finally {
  killChrome();
  if (!process.env.KEEP) { await sleep(300); fs.rmSync(tmp, { recursive: true, force: true }); }
}
process.exit(code);
