<div align="center">

# MonkGrab — Webpage to Markdown, in one click

**Save any webpage as clean Markdown — including content locked inside cross-origin iframes** that copy-paste, bookmarklets, and most "save to Markdown" tools simply can't reach.

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

You're reading a page — an article, a course lesson, an embedded doc — and you want it
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

> Note: reaching cross-origin frames is **only** possible with a host permission —
> Chrome's `activeTab` permission explicitly does not cover them. That's why MonkGrab
> requests broad host access, and why it does so transparently. See
> [Permissions & privacy](#permissions--privacy).

## Features

- **One click / one hotkey** — `⌘⇧G` on Mac, `Ctrl+Shift+G` elsewhere. No popup, no UI to learn.
- **Cross-origin iframes included** — the whole reason it exists.
- **Clean Markdown** — headings, paragraphs, lists, bold/italic, links, images, inline code, code blocks, blockquotes, rules.
- **Absolute links & images** — relative `href`/`src` are resolved to full URLs so they still work after the file leaves the site.
- **Smart content detection** — ranks frames by text volume, keeps the main content, drops nav/chrome/ad widgets.
- **Auto-named files** — `<domain>_<slug>_<YYYY-MM-DD_HH-MM-SS>.md`, with title, source URL, and capture time at the top.
- **100% local** — conversion runs in your browser, output goes only to your disk. No Python, no server, no network calls. See [PRIVACY.md](PRIVACY.md).

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

Until it's approved the link may 404 — install from source above in the meantime.

## Usage

Open any page, then:

- **Click** the MonkGrab toolbar icon, **or**
- **Press** `⌘⇧G` (Mac) / `Ctrl+Shift+G` (Windows/Linux).

A badge flashes on the icon — a teal **✓** on success, a red **!** on failure (with the
reason; hover or check the file didn't download). The `.md` file appears at:

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
| `<all_urls>` host access | Read content inside **cross-origin iframes** — impossible without it (`activeTab` can't reach cross-origin frames). Used only when you click/hotkey. |
| `scripting` | Run the DOM→Markdown converter inside each frame. |
| `downloads` | Write the `.md` file to your Downloads folder. |

The host permission is broad because the feature requires it, but it is exercised
**only on your explicit action** — never on page load, never in the background. Nothing
ever leaves your machine.

## How it works (for developers)

MonkGrab is a single MV3 background **service worker** — no content scripts, no popup,
no remote code, no build step required to run it.

1. **Trigger.** `chrome.action.onClicked` (toolbar) and `chrome.commands.onCommand`
   (hotkey) both call `grab()`.
2. **Inject everywhere.** `grab()` finds the active tab and calls
   `chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: extractFrame })`.
   `extractFrame` is serialized and run independently inside **every frame** of the tab,
   each in its own origin — this is what defeats the cross-origin wall.
3. **DOM → Markdown.** Inside each frame, `extractFrame` walks the DOM from the best
   content root (`main` → `[role=main]` → `article` → `body`). A `block()` walker handles
   block elements (headings, paragraphs, lists, `pre`, blockquotes, rules, images) and an
   `inline()` walker handles inline formatting (bold, italic, code, links, images),
   resolving relative URLs to absolute via `new URL(u, location.href)`. Non-content tags
   (`script`, `style`, `nav`, `header`, `footer`, `svg`, `button`, `form`, `iframe`) are
   skipped. Each frame returns `{ url, title, md, len }`.
4. **Rank & assemble.** Frames are filtered (`len > 150`) and sorted by text length. The
   top frame is the main content; secondary frames are appended only if they clear a
   real-content floor (`max(500, 15% of the main frame)`), which filters out ads/widgets.
5. **Name & download.** `buildName()` produces `<domain>_<slug>_<date>_<time>.md`
   (slug from the page title, sanitized). The Markdown is encoded as a
   `data:text/markdown` URL and handed to `chrome.downloads.download`.
   > Why a `data:` URL and not a Blob? `URL.createObjectURL` is unavailable in MV3
   > service workers, so a `data:` URL is the correct way to download generated text.
6. **Feedback.** A badge (`✓` / `!`) flashes for ~2s via `chrome.action.setBadgeText`.

Everything lives in [`background.js`](background.js) and is heavily commented. There is
no transpilation, bundler, or dependency — it's plain ES that Chrome runs directly.

## Project layout

```
manifest.json     Extension config (Manifest V3)
background.js     Service worker: inject-all-frames + DOM→Markdown + download
icons/            Toolbar / store icons (16, 32, 48, 128 + source SVG)
PRIVACY.md        Privacy policy (no data collection)
CHANGELOG.md      Version history
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
permission, use [PRIVACY.md](PRIVACY.md) — it's written for exactly that review.

## Known limitations

- **Tables** aren't converted to Markdown tables yet — cell text falls through as plain text.
- **Very large pages** are encoded as a `data:` URL; extremely large captures can hit Chrome's URL-length ceiling and fail the download (rare).
- **JS-rendered content** must already be on the page when you invoke MonkGrab — it reads the live DOM, it doesn't wait for lazy loads.
- **`chrome://`, the Web Store, and other restricted pages** can't be injected into (Chrome forbids it); MonkGrab will report "Inject failed" there.

## Roadmap

- Real monkfromearth brand icon (current is a placeholder mark)
- Table → Markdown-table conversion
- Optional "copy to clipboard" mode
- Options page: iframe-only mode, content-frame threshold, filename template
- Chrome Web Store listing

## Contributing

Issues and PRs welcome. The codebase is intentionally a single dependency-free file —
keep changes plain ES, keep the service worker the only moving part, and don't add a
build step for the runtime. Run `node --check background.js` before pushing.

## License

MIT — see [LICENSE](LICENSE). © 2026 Sameer Khan (monkfromearth).
