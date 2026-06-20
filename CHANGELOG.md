# Changelog

All notable changes to MonkGrab are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); versions follow
[SemVer](https://semver.org/).

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
