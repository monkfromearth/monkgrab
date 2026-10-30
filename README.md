<div align="center">

# MonkGrab: Webpage to Markdown, in one click

**Save any webpage as clean Markdown, including content locked inside cross-origin iframes** that copy-paste, bookmarklets, and most "save to Markdown" tools simply can't reach.

[![Chrome Web Store](https://img.shields.io/badge/Chrome%20Web%20Store-in%20review-f0a020)](https://chromewebstore.google.com/detail/babcbelnbfdgmandombjmhdhedknfpdh)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-14b8a6)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![No tracking](https://img.shields.io/badge/tracking-none-success)](PRIVACY.md)

Built by [monkfromearth](https://monkfrom.earth) · [Documentation site](https://monkfromearth.github.io/monkgrab/)

</div>

---

## Table of contents

- [What it does](#what-it-does)
- [Why it's different](#why-its-different)
- [Features](#features)
- [Install](#install)
- [Usage](#usage)
- [Output format](#output-format)
- [Permissions & privacy](#permissions--privacy)
- [How it works (for developers)](#how-it-works-for-developers)
- [Project layout](#project-layout)
- [Build a Web Store package](#build-a-web-store-package)
- [Known limitations](#known-limitations)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)

---

## What it does

You're reading a page (an article, a course lesson, an embedded doc) and you want it
as Markdown. Click the MonkGrab icon (or hit the hotkey). A `.md` file lands in your
Downloads folder. No popup, no second step, no server, no copy-paste.

The trick: it also grabs content that's **embedded from another website** inside the
page, which is exactly the content every other tool drops.

## Why it's different

Browsers deliberately block one site from reading an iframe served by a different
domain (the same-origin policy). So embedded readers, course players, and docs
viewers usually come out **empty** when you try to "save as Markdown."

MonkGrab sidesteps this the only way Chrome allows: it asks for host access to the
page and injects its converter into **every frame** (`allFrames: true`). The code then
runs *inside* each frame's own origin, where the cross-origin wall doesn't apply, reads
that frame's DOM, and turns it into Markdown on the spot. The frames are ranked by how
much real text they hold, the main one is kept, and any other substantial frame is
appended below it. Ad and widget frames are filtered out.

> Note: reaching cross-origin frames is **only** possible with a host permission;
> Chrome's `activeTab` permission explicitly does not cover them. That's why MonkGrab
> requests broad host access, and why it does so transparently. See
> [Permissions & privacy](#permissions--privacy).

## Features

- **One click / one hotkey**: `⌘⇧G` on Mac, `Ctrl+Shift+G` elsewhere. No popup, no UI to learn.
- **Cross-origin iframes included**: the whole reason it exists.
- **Clean Markdown**: headings, paragraphs, lists, bold/italic, links, images, inline code, code blocks, blockquotes, rules.
- **Absolute links & images**: relative `href`/`src` are resolved to full URLs so they still work after the file leaves the site.
- **Form answers captured**: every radio, checkbox, toggle, dropdown and text box is written with its current state (`(x)`, `[x]`, `Selected:`, `Value:`), read live, so answers you changed after the page loaded count.
- **Whole task pages**: forms are walked like any other block, so a task page whose questions sit inside one big `<form>` is kept in full, in page order.
- **Never drops a big block**: the main content goes first; prose outside it (1,500+ characters that aren't link text) and every substantial frame are appended. Menus, link lists, and small ad/widget frames are left out.
- **Ordinary pages unchanged**: articles, docs and blogs come out as they did in 1.0.1. Search boxes, empty sign-up and comment forms, Like/Follow buttons, menu items and code tabs are left out.
- **Says why a save failed**: if Chrome can't write the file (a missing or read-only downloads folder, a full disk, a policy block), the icon keeps a red **!** and hovering it shows the reason.
- **Warns about hidden content**: if a carousel shows "item 1 of 9" or a tab's panel is not on the page, the file says so at the top.
- **Auto-named files**: `<domain>_<slug>_<YYYY-MM-DD_HH-MM-SS>.md`, with title, source URL, and capture time at the top.
- **100% local**: conversion runs in your browser, output goes only to your disk. No Python, no server, no network calls. See [PRIVACY.md](PRIVACY.md).

## Install

### From source (developer mode)

1. Download or clone this repository.
2. Open Chrome and go to `chrome://extensions`.
3. Toggle **Developer mode** ON (top-right).
4. Click **Load unpacked** and select the project folder (the one containing `manifest.json`).
5. Pin the MonkGrab icon to your toolbar.
6. (Optional) Set or change the hotkey at `chrome://extensions/shortcuts`.

Works on Chrome 102+ and any Chromium-based browser that supports Manifest V3
(Edge, Brave, Arc, Opera).

### Chrome Web Store

🚧 **In review.** The listing is submitted and pending Google's review (extensions
with broad host access get an in-depth review, so this takes a little longer):

**https://chromewebstore.google.com/detail/babcbelnbfdgmandombjmhdhedknfpdh**

Until it's approved the link may 404; install from source above in the meantime.

## Usage

Open any page, then:

- **Click** the MonkGrab toolbar icon, **or**
- **Press** `⌘⇧G` (Mac) / `Ctrl+Shift+G` (Windows/Linux).

A teal **✓** flashes on the icon when the file is saved. If it can't be saved, a red
**!** stays on the icon until your next grab: hover the icon to see why (for example,
the downloads folder is missing or read-only). The `.md` file appears at:

```
Downloads/monkgrab/<domain>_<slug>_<date>_<time>.md
```

## Output format

The saved file starts with a small header, then the content:

```markdown
# Page Title

> Source: https://example.com/the/page
> Captured: Sat Jun 20 2026 14:31:02 GMT+0530 (India Standard Time)

---

...the page content as Markdown...
```

On pages with form fields, two more header lines can appear:

```markdown
> Form: 350 choice options in 96 groups (93 picked, 3 groups with no pick), 27 checkboxes and toggles (13 on), 1 dropdown, 42 text fields (39 filled)
> Warning: "Currently viewing item 1 of 9": this part of the page shows one item at a time, ...
```

Form controls use one fixed marker per type, so a script can grep them:

| Control | Output |
|---|---|
| Radio, `role=radio`/`option`, and inside a form: tabs, `aria-selected` buttons, class-only option groups | `(x) PASS` picked, `( ) FAIL` not picked |
| Checkbox, switch, `aria-checked`, and inside a form: `aria-pressed` toggles, `data-state` toggles | `[x] Ran the tests`, `[ ] Not done`, `[-]` mixed |
| Dropdown (`<select>`) | `Selected: High (options: Low \| Medium \| High)` |
| Text input | `Value: Doc` or `Value: (empty)` (empty search boxes are left out) |
| Textarea | `Value:` then the full text in a fenced block |

If extra content frames qualify, each is appended under a divider with a comment
noting its source frame:

```markdown
---
<!-- frame: https://embed.other-domain.com/reader -->

...that frame's content as Markdown...
```

## Permissions & privacy

MonkGrab collects nothing and transmits nothing. Full policy: **[PRIVACY.md](PRIVACY.md)**.

| Permission | Why it's needed |
|---|---|
| `<all_urls>` host access | Read content inside **cross-origin iframes**: impossible without it (`activeTab` can't reach cross-origin frames). Used only when you click/hotkey. |
| `scripting` | Run the DOM→Markdown converter inside each frame. |
| `downloads` | Write the `.md` file to your Downloads folder. |

The host permission is broad because the feature requires it, but it is exercised
**only on your explicit action**: never on page load, never in the background. Nothing
ever leaves your machine.

## How it works (for developers)

MonkGrab is a single MV3 background **service worker**: no content scripts, no popup,
no remote code, no build step required to run it.

1. **Trigger.** `chrome.action.onClicked` (toolbar) and `chrome.commands.onCommand`
   (hotkey) both call `grab()`.
2. **Inject everywhere.** `grab()` finds the active tab and calls
   `chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: extractFrame })`.
   `extractFrame` is serialized and run independently inside **every frame** of the tab,
   each in its own origin; this is what defeats the cross-origin wall.
3. **DOM → Markdown.** Inside each frame, `extractFrame` picks a root: `main` →
   `[role=main]` → `article` → `body`. Anything outside that root with 1,500+ characters
   of prose (link text doesn't count, so menus don't qualify) or a filled-in text area is
   appended after it. A `block()` walker handles block elements (headings,
   paragraphs, lists, `pre`, blockquotes, rules, images, forms) and an `inline()` walker
   handles inline formatting (bold, italic, code, links, images), resolving relative
   URLs to absolute via `new URL(u, location.href)`. Form controls are rendered from
   their live DOM state (see [Output format](#output-format)). Skipped: non-content tags
   (`script`, `style`, `svg`, `template`, `iframe`...), every `nav`, any `header`/`footer`
   that isn't an article's own, and small search/sign-up/comment forms with nothing typed in them.
   Each frame returns `{ url, title, md, len, stats, warnings }`.
4. **Rank & assemble.** Frames are filtered (`len > 150`), de-duplicated and sorted by
   text length. The biggest frame goes first; every other frame with 500+ characters
   or a filled-in answer is appended. Only small ad/widget frames are left out.
5. **Name & download.** `buildName()` produces `<domain>_<slug>_<date>_<time>.md`
   (slug from the page title, sanitized). The Markdown is encoded as a base64
   `data:text/markdown` URL and handed to `chrome.downloads.download`.
   > Why a `data:` URL and not a Blob? `URL.createObjectURL` is unavailable in MV3
   > service workers, so a `data:` URL is the correct way to download generated text.
6. **Feedback.** `chrome.downloads.download()` resolves when the download *starts*, so
   `grab()` waits for `chrome.downloads.onChanged` to report `complete` or `interrupted`
   before it answers. Success flashes `✓` for 2s; a failure keeps `!` on the icon and puts
   the reason in its tooltip (`chrome.action.setTitle`) until the next grab.

Everything lives in [`background.js`](background.js) and is heavily commented. There is
no transpilation, bundler, or dependency; it's plain ES that Chrome runs directly.

## Project layout

```
manifest.json     Extension config (Manifest V3)
background.js     Service worker: inject-all-frames + DOM→Markdown + download
icons/            Toolbar / store icons (16, 32, 48, 128 + source SVG)
PRIVACY.md        Privacy policy (no data collection)
CHANGELOG.md      Version history
test/             Test pages + runners (run.mjs, e2e.mjs, compare.mjs; see Testing)
build.sh          Produces the Web Store upload zip
docs/             GitHub Pages documentation site
LICENSE           MIT
```

## Build a Web Store package

The repo ships a small script that zips exactly the files Chrome needs (manifest,
service worker, icons) and nothing else:

```bash
./build.sh
# -> dist/monkgrab-v<version>.zip
```

Upload that zip to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole/).
When the listing asks for a privacy policy and a justification for the broad host
permission, use [PRIVACY.md](PRIVACY.md); it's written for exactly that review.

## Testing

```bash
node test/run.mjs                      # bundled test pages, frames, download errors
node test/run.mjs saved-page.html      # also cross-check any saved page
node test/compare.mjs [url ...]        # 1.0.1 vs current on real sites
CHROME="/path/to/Chrome for Testing" node --experimental-websocket test/e2e.mjs
```

- `run.mjs` needs [agent-browser](https://github.com/vercel-labs/agent-browser). It runs
  the real `extractFrame` in headless Chrome and the real `grab()` in a Node sandbox. It
  checks every radio, checkbox, dropdown and textarea against the page's live state, that
  `test/ordinary-page.html` comes out the same as 1.0.1 (the old converter is read from
  git history), and that a download Chrome fails late is reported as a failure.
- `compare.mjs` runs the 1.0.1 converter and the current one on the same live pages and
  lists every line one has and the other doesn't. Use it before a release.
- `e2e.mjs` loads the unpacked extension in Chrome for Testing or Chromium (branded
  Chrome ignores `--load-extension`), checks the file Chrome actually downloads, then
  makes the downloads folder read-only and checks that the icon shows `!` and the reason.

## Known limitations

- **Tables** aren't converted to Markdown tables yet; cell text falls through as plain text.
- **Links placed directly in a `<div>`** (not in a paragraph, list or heading) keep their text but lose their URL. This is unchanged from 1.0.1.
- **Web components**: content inside shadow roots isn't captured.
- **Very large pages** are encoded as a base64 `data:` URL; captures over about 1.5 MB of Markdown can hit Chrome's 2 MB URL ceiling and fail the download.
- **One-at-a-time views** (carousels, unopened tabs, collapsed sections) whose content is not on the page can't be read. MonkGrab captures hidden panels that are on the page, and writes a `> Warning:` line when it spots content that isn't. It never clicks anything on your page.
- **Code editors and virtual lists** (Monaco, long feeds) only keep the lines currently on screen in the page, so only those are captured.
- **JS-rendered content** must already be on the page when you invoke MonkGrab; it reads the live DOM, it doesn't wait for lazy loads.
- **`chrome://`, the Web Store, and other restricted pages** can't be injected into (Chrome forbids it); MonkGrab will report "Inject failed" there.

## Roadmap

- Real monkfromearth brand icon (current is a placeholder mark)
- Table → Markdown-table conversion
- Optional "copy to clipboard" mode
- Options page: iframe-only mode, content-frame threshold, filename template
- Chrome Web Store listing

## Contributing

Issues and PRs welcome. The codebase is intentionally a single dependency-free file. Keep changes plain ES, keep the service worker the only moving part, and don't add a
build step for the runtime. Run `node --check background.js` and `node test/run.mjs` before pushing.

## License

MIT. See [LICENSE](LICENSE). © 2026 Sameer Khan (monkfromearth).
