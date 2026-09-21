# Gramini — build notes

Running log of selector changes, gaps found in testing, and the test log.
Spec: [graminiSPEC.md](graminiSPEC.md).

## Setup

- Project file is generated, not committed: `xcodegen generate && open Gramini.xcodeproj`.
- The iOS target references `shared/filter.js` and `shared/filter.css` directly as
  bundle resources, so there is a single source of truth. `scripts/sync-filter.sh`
  (phase 5) only needs to copy them into `chrome/`.
- Icon: `python3 -m venv tools/.venv && tools/.venv/bin/pip install pillow`, then
  `tools/.venv/bin/python tools/gen_icon.py`.

## Phase 1 — shell app (2026-09-21)

- Start URL `https://www.instagram.com/?variant=following` — **verify in phase 2**
  that Instagram still honours `variant=following`.
- Domain allowlist (`WebViewController.allowedHostSuffixes`): `instagram.com`,
  `cdninstagram.com`, `fbcdn.net`, plus `facebook.com`, `fb.com`, `meta.com` as a
  guess for the login/checkpoint flow. **Trim or extend after the first real login.**
- `l.instagram.com/?u=…` outbound redirects are unwrapped and opened in Safari.
- Safe areas: the web view is full-bleed and relies on WKWebView's automatic content
  inset adjustment, so Instagram's fixed header sits below the status bar and the
  page background bleeds behind it.
- Pull-to-refresh on the feed (`/`) reloads the Following URL; elsewhere it reloads
  the current page. Phase 3 revisits this with the end card.
- Simulator check (iPhone 17 Pro, iOS 26.5, logged out): landing page and
  `/accounts/login/` render inside the app; safe areas correct; filter.js runs in
  the main frame and in `about:blank` sub-frames.
- **Lesson:** the logged-out landing page has an "Open Instagram" button. Climbing
  from it to a "banner container" hid the whole hero (elements report 0 height
  during Instagram's splash transition, so height caps don't help). Text matches now
  hide only the control itself; anchor matches climb only through laid-out,
  short, ≤3-child ancestors with no login link. Re-check against the logged-in
  DOM in phase 2 — the language picker and "from Meta" footer also disappear on
  the landing page, cause not yet identified.

## Selector changes

_(none yet)_

## Gaps found

_(none yet)_

## Test log

| Date | Build | Result |
|---|---|---|
| 2026-09-21 | phase 1, simulator | Launches, landing + login page render, in-app navigation OK. Not yet run on device. |
