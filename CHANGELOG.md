# Changelog

All notable changes to MonkGrab are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); versions follow
[SemVer](https://semver.org/).

## [1.0.1] — 2026-06-20

### Fixed
- **Bullet-list content silently dropped on some pages.** Lists were collected by
  scanning a `<ul>`/`<ol>`'s direct `<li>` children. Renderers that emit invalid
  markup (e.g. `<ul><p><li>...</li></p></ul>`, seen on Karat's question guides)
  cause the browser to reparent the `<li>`s, so the direct-child scan captured
  nothing and whole sections (scoring rubrics, clarifications) came out empty.
  Now list items are found by their nearest list ancestor (`li.closest("ul,ol")`),
  which is robust to that reparenting. Verified against the real page markup.

## [1.0.0] — 2026-06-20

First public release.

### Added
- One-click / one-hotkey (`⌘⇧G` · `Ctrl+Shift+G`) capture of any page to Markdown.
- Cross-origin iframe content extraction via all-frames injection — the core feature.
- DOM→Markdown converter: headings, paragraphs, lists, bold/italic, inline code,
  code blocks, blockquotes, rules, images, links.
- Relative `href`/`src` resolved to absolute URLs so links survive off-site.
- Frame ranking that keeps the main content and drops nav/ad/widget frames.
- Auto-named downloads: `<domain>_<slug>_<date>_<time>.md` with a title/source/time header.
- Badge feedback (✓ / !) on the toolbar icon.
- Privacy policy (no data collection, fully local), full README docs, GitHub Pages site,
  and a Web Store packaging script.

[1.0.0]: https://github.com/monkfromearth/monkgrab/releases/tag/v1.0.0
