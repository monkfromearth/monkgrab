# MonkGrab: Privacy Policy

_Last updated: 2026-06-20_

**MonkGrab collects nothing. It sends nothing anywhere. Everything happens on your own machine.**

## What MonkGrab does

When you click the MonkGrab toolbar icon (or press its hotkey) on a page, the
extension reads the visible content of that page (including content inside
cross-origin iframes), converts it to Markdown, and saves it as a `.md` file in
your local Downloads folder. That is the entire function.

## Data collection

**None.** MonkGrab does not collect, store, transmit, sell, or share any data.

- No analytics, no telemetry, no tracking, no crash reporting.
- No accounts, no logins, no identifiers.
- No remote servers are contacted. The extension makes **zero network requests**.
- No data ever leaves your device. The Markdown file is written directly to your
  local disk and nowhere else.

## Why the broad host permission?

MonkGrab requests access to all sites (`host_permissions: <all_urls>`). This is
required, not optional, and here is exactly why:

- The whole point of MonkGrab is capturing content that lives inside **cross-origin
  iframes** (embedded readers, course lessons, docs viewers). Chrome's security model
  **does not** let the `activeTab` permission reach cross-origin frames; only an
  explicit host permission can. Without `<all_urls>`, the core feature is impossible.
- The permission is used **only when you explicitly invoke the extension** (a click
  or the hotkey). MonkGrab never reads pages in the background, on page load, or
  without an action from you.
- The captured content is converted to Markdown locally and written only to your
  Downloads folder. It is never uploaded or inspected by anyone.

## Permissions, in plain terms

| Permission | Why it's needed |
|---|---|
| `<all_urls>` (host access) | Read content inside cross-origin iframes when you invoke MonkGrab. The reason the extension exists. |
| `scripting` | Run the DOM-to-Markdown converter inside each frame of that page. |
| `downloads` | Save the resulting `.md` file to your Downloads folder. |

## Note on what gets captured

Because MonkGrab reads every frame of the page you invoke it on, the saved file
includes whatever those frames contain at that moment. You are saving your own
page, to your own disk, by your own action, and nothing is shared. If a page shows
sensitive content in a frame, that content will appear in the file you save.
Treat the saved `.md` as you would any other personal download.

## Changes

If this policy ever changes, the updated date above will change and the new version
will ship with the extension.

## Contact

Questions: [monkfrom.earth](https://monkfrom.earth) · GitHub Issues on the
[MonkGrab repository](https://github.com/monkfromearth/monkgrab).
