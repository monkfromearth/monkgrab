# 2026-10-30-form-capture

MonkGrab 1.1.0. Full release notes: [CHANGELOG.md](../CHANGELOG.md#110---2026-10-30).

## Fixed
- Task and form pages lost almost everything: forms and buttons were skipped, so a
  DataAnnotation task page saved 19 KB (the chat) out of about 150 KB. It now saves
  the instructions, every section, the chat and every answer.
- A save Chrome failed after it started (missing or read-only downloads folder, full
  disk, policy block) showed a check mark and wrote no file. It now shows a red `!`
  and the reason on hover.
- Large prose blocks outside `<main>` and secondary frames under 15% of the main frame
  were dropped. They are appended now.
- An article's own header (title, byline) was dropped. Inline `<style>` text leaked
  into paragraphs.

## Added
- Live form state with one marker per control type: `(x)`/`( )`, `[x]`/`[ ]`/`[-]`,
  `Selected:`, `Value:`.
- `> Form:` and `> Warning:` header lines.

## Changed
- Downloads use a base64 `data:` URL.

## Unchanged
- Ordinary pages (articles, docs, blogs) come out as in 1.0.1, apart from the fixes above.

## Code quality (strict review, then restructure)
- The converter moved to `extract.js` (loaded with `importScripts`), so `background.js`
  is only the service worker (167 lines) and the tests read the converter directly
  instead of cutting it out with a regex.
- One place decides what a label, field or option prints (`formText`), one place decides
  what counts as page clutter (`isNoise`, `isUiField`), and option detection is split
  into strong signals (count anywhere) and weak signals (count only inside a form).
- Option lines carry a private mark, so a plain paragraph that starts with "(x)" is no
  longer glued to its neighbour. Links and images are marked as they are written, so the
  prose outside `<main>` is measured without guessing where a link starts and ends.
- Two bugs found by the review and fixed: a checkbox in `<main>` labelled from outside it
  printed twice and was counted twice; paragraphs starting with "(x)" / "( )" lost their
  blank line.
- Re-review found one more: words in separate `<span>`s were measured without the
  spaces between them. Fixed and pinned (main-plus-aside.html).
- Proof the restructure changed nothing else: snapshot diff on the 4 test pages (only the
  2 bug fixes changed) and byte-identical output on 13 to 14 live sites, before vs after.

## Tests
- CodeRabbit CLI: 2 findings on earlier commits, both fixed.
- `node test/run.mjs`: 38 checks pass on the bundled pages (form state with every
  custom-option signal, ordinary page vs 1.0.1 exactly with blank lines, main content
  with a label outside it, frame selection, download errors). With the saved DA STA-4
  page added: 42 pass (350 radios, 20 checkboxes, 1 select, 38 filled textareas, all
  matching the page's live state).
- `test/e2e.mjs` in Chrome for Testing 1208 with the unpacked extension: 2 of 2 pass
  (the right file downloaded; a read-only folder shows `!` and the reason).
- `test/compare.mjs`, 1.0.1 vs 1.1.0 on 16 live sites over two runs. 15 loaded (GitHub
  timed out both times). The output was identical on 10 (MDN, Paul Graham, the Hacker
  News front page and a 29 KB comment thread, Python docs, react.dev, BBC,
  monkfrom.earth, plus 2 bot-check pages). On the other 5, every
  difference is one of the fixes above: Wikipedia (CSS no longer leaks), arxiv (toggles
  marked), tailwindcss.com (theme radios marked), dev.to (sidebar prose appended), and
  Pragmatic Engineer (post titles from article headers).
- Not tested: the live STA-4 page in a real Chrome profile (Doc's check), and
  DataAnnotation's Carousel view (the same layout passes on the test page).
