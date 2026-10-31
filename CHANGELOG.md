# Changelog

All notable changes to MonkGrab are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); versions follow
[SemVer](https://semver.org/).

## [1.1.0] - 2026-10-30

### Fixed
- **Task and form pages lost almost everything.** The converter skipped every
  `<form>` and `<button>`. When a page puts the whole task inside one form (a
  DataAnnotation task page, for example), the instructions and every question were
  dropped and only the chat block outside the form was saved: 19 KB out of a page
  holding about 150 KB of text. Forms and buttons are now walked like any other block.
- **Large blocks outside `<main>` were dropped.** `main` / `article` still comes first,
  and anything outside it with 1,500+ characters of prose (link text doesn't count, so
  menus and link lists don't qualify) or a filled-in text area is appended under
  `<!-- outside the main content -->`.
- **A save Chrome failed was shown as a success.** `chrome.downloads.download()` resolves
  when the download starts; a missing or read-only downloads folder, a full disk or a
  policy block fails it afterwards, with no file and a ✓ on the icon. MonkGrab now waits
  for the end state. On failure the red `!` stays on the icon, and hovering it shows the
  reason and what to check, until the next grab.
- **Extra frames under 15% of the main frame were dropped.** Every frame with 500+
  characters, or with a filled-in answer, is now kept. Identical frames print once.
- An article's own `<header>` (its title and byline) was dropped with the site header.
  It is kept now. Every `nav` and every other `header` / `footer` is still skipped.
- Inline `<style>` and `<script>` text no longer leaks into paragraphs (seen on Wikipedia
  citations).
- Blank lines inside `<pre>` blocks were collapsed. They are kept verbatim now, and
  the code fence grows past any backticks inside the code.

### Added
- **Form state.** Every control is written with its live state (the DOM property, not
  the HTML attribute, so changes made after page load count), one fixed marker per type:
  - `(x) PASS` / `( ) FAIL` for single-choice options: native radios, `role=radio` and
    `option`; inside a form or choice group also tabs, Radix-style `data-state`, and
    class-only option groups (`selected` / `active` / `checked` on the option or its wrapper).
  - `[x]` / `[ ]` / `[-]` for checkboxes, switches and `aria-checked`; inside a form or
    choice group also `aria-pressed` toggles and `data-checked`. Outside one, Like/Follow
    buttons, menu items and code tabs are page UI and are left out, as before.
  - `Selected: <option>` for dropdowns (multi-selects joined with `; `).
  - `Value: <text>` for text fields; textarea values in full inside a fenced block.
    Password values are never written. Empty search boxes are left out.
- A `> Form:` header line counting choice options, picks, groups with no pick,
  toggles, dropdowns and filled text fields.
- `> Warning:` header lines when content is not on the page: a one-at-a-time pager
  ("item 1 of 9"), tabs whose panel is missing, and collapsed sections with no content.
  Hidden panels and closed `<details>` that ARE on the page are captured in full.
- `test/`: test pages for form state, ordinary articles and main-content pages;
  `run.mjs` (checks the output against the live page state, checks the ordinary page
  matches 1.0.1, and checks late download failures); `compare.mjs` (1.0.1 vs current
  on real sites); and `e2e.mjs` (loads the real extension in Chromium, checks the
  downloaded file and a failed save into a read-only folder).

### Unchanged on ordinary pages
- Articles, docs and blogs come out as in 1.0.1. Checked with `test/compare.mjs` on 15
  live sites: MDN, Paul Graham, Hacker News (front page and a comment thread), Python
  docs, react.dev, BBC and monkfrom.earth came out identical. Where a page differs, it is
  one of the fixes above: no CSS in the text (Wikipedia), article headers kept (blog
  index pages), prose outside `main` appended (the dev.to sidebar), and real checkboxes
  and ARIA radios marked (arxiv's toggles, tailwindcss.com's theme picker).
- Small search, sign-up, log-in and comment forms with nothing typed in them are still
  skipped.

### Changed
- The download is a base64 `data:` URL (about 1.33x the text, where percent-encoding
  was up to 3x), so large captures stay under Chrome's 2 MB URL limit.
- The converter moved from `background.js` to `extract.js`, which the service worker
  loads with `importScripts`. The tests read it directly. The Web Store zip includes it.

## [1.0.1] - 2026-06-20

### Fixed
- **Bullet-list content silently dropped on some pages.** Lists were collected by
  scanning a `<ul>`/`<ol>`'s direct `<li>` children. Renderers that emit invalid
  markup (e.g. `<ul><p><li>...</li></p></ul>`, seen on Karat's question guides)
  cause the browser to reparent the `<li>`s, so the direct-child scan captured
  nothing and whole sections (scoring rubrics, clarifications) came out empty.
  Now list items are found by their nearest list ancestor (`li.closest("ul,ol")`),
  robust to that reparenting.
- **Nested list items collapsed into their parent bullet.** Sub-bullets (e.g. a
  scoring tier's individual points) were flattened onto one line, making sections
  read as if content were missing. A dedicated `renderList` walker now renders
  lists with proper indentation at any nesting depth, keeping each item on its own
  line. Verified against real page markup: 159/159 rendered source lines captured,
  0 dropped.

## [1.0.0] - 2026-06-20

First public release.

### Added
- One-click / one-hotkey (`⌘⇧G` · `Ctrl+Shift+G`) capture of any page to Markdown.
- Cross-origin iframe content extraction via all-frames injection (the core feature).
- DOM→Markdown converter: headings, paragraphs, lists, bold/italic, inline code,
  code blocks, blockquotes, rules, images, links.
- Relative `href`/`src` resolved to absolute URLs so links survive off-site.
- Frame ranking that keeps the main content and drops nav/ad/widget frames.
- Auto-named downloads: `<domain>_<slug>_<date>_<time>.md` with a title/source/time header.
- Badge feedback (✓ / !) on the toolbar icon.
- Privacy policy (no data collection, fully local), full README docs, GitHub Pages site,
  and a Web Store packaging script.

[1.0.0]: https://github.com/monkfromearth/monkgrab/releases/tag/v1.0.0
