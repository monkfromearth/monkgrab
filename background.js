// MonkGrab service worker. A click or the hotkey injects extractFrame (extract.js)
// into EVERY frame of the active tab (allFrames bypasses the cross-origin iframe wall,
// since the function runs inside each frame's own context), keeps the content frames,
// and downloads ONE .md file named <domain>_<title>_<datetime>.md.

importScripts("extract.js"); // defines extractFrame()

const MIN_FRAME_CHARS = 150;   // frames with less are empty or broken
const EXTRA_FRAME_CHARS = 500; // other frames this size or bigger are content, not ads
const DOWNLOAD_WAIT_MS = 15000; // a save still running after this is slow, not failed

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
  const s = {};
  frames.forEach((f) => { for (const k in f.stats || {}) s[k] = (s[k] || 0) + f.stats[k]; });
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
    .filter((f) => f && f.len > MIN_FRAME_CHARS && !seen.has(f.md) && seen.add(f.md))
    .sort((a, b) => b.len - a.len);
  if (!ranked.length) return { ok: false, msg: "No content found on this page." };

  const best = ranked[0];
  // Keep the biggest frame first, then every other frame with real content or a
  // filled-in answer. Only small ad/widget frames are left out.
  const frames = [best, ...ranked.slice(1).filter((f) => f.len >= EXTRA_FRAME_CHARS ||
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
function downloadError(id) {
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
    const timer = setTimeout(() => finish(null), DOWNLOAD_WAIT_MS);
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
