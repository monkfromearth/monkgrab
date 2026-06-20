# Changelog

All notable changes to MonkGrab are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); versions follow
[SemVer](https://semver.org/).

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
