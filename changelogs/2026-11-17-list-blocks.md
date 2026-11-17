# 2026-11-17-list-blocks

MonkGrab 1.1.1. Full release notes: [CHANGELOG.md](../CHANGELOG.md#111---2026-11-17).

## Fixed
- Content in a `<ul>`/`<ol>` that is not inside any `<li>` was dropped. A real profile
  page put its whole detail section that way: MonkGrab saved 4.6 KB with no About text
  and no section headings, while another extension saved the full page. It now keeps
  that content as ordinary blocks, in page order.
- Block elements inside one line of text (a list item, a link) are separated by a
  space: `Age25 to 33` is now `Age 25 to 33`.

## Unchanged
- List items are found the same way (nearest list ancestor, wrappers walked through),
  so nested and invalid lists indent as before.
- A `<hr>` divider inside a list is still left out.

## Tests
- New fixture `test/list-with-blocks.html` with 14 expected lines, 2 passages, 2
  unwanted strings and 3 print-once checks. All checks in `node test/run.mjs` pass
  (four fixtures, frame selection, download errors).
- The ordinary page still matches 1.0.1 line for line.
- `BASE=7880382 node test/compare.mjs` (1.1.0 vs this branch), 16 default sites plus
  Wikipedia (Bhopal) and The Verge. GitHub timed out in headless Chrome and was skipped.
  13 identical. Differences, all checked by hand:
  - BBC, The Verge: numbered "most read" items gain a space after the number.
  - Wikipedia (Bhopal): three gallery captions gain a space after the image.
  - arXiv: one screen-reader line inside the "Access Paper" list is now kept (the same
    text was already in the output once, higher up).
- dev.to: menu dividers inside a list first came out as `---` lines; the divider rule
  removed them, and dev.to is identical again.
