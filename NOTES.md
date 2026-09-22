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

## Phase 2 — filters (2026-09-21)

Structure observed (desktop Chrome, logged in; phone via the DEBUG probe):

- `?variant=following` is honoured on both layouts; the header then shows a
  "Following" title inside `a[href="/"]` (a back arrow to For You). We point every
  `a[href="/"]` at the Following URL and make the title inert. A JS redirect
  (rate-limited: 4 s cooldown, 4/min) is the fallback.
- Nav entries are `a[href="/reels/"]`, `a[href="/explore/"]`, `a[href="/direct/inbox/"]`,
  each wrapped in single-child divs. `svg[aria-label]` names them (Home, Explore,
  Reels, Messages, Notifications, New post). Bottom bar on phone, left rail on desktop.
- DM badge: `div[aria-label^="Direct messaging - N new notifications"]` plus a numeric span.
- Stories tray items: `div[role=button][aria-label^="Story by <user>, (not )seen"]`;
  the list is a `<ul>` on desktop and a plain `<div>` with ~10 children on phone.
- Feed posts are `<article>`; the post link is `/p/<code>/` (profiles use
  `/<user>/p/<code>/` and `/<user>/reel/<code>/`); `<time datetime>` is inside it.
  **The feed is virtualised** — only 1–3 articles exist in the DOM at once.
- Instagram's own "You're all caught up" divider sits in the feed container as a
  non-article sibling; a "Suggested Posts" `<h3>` and suggested articles follow it.
- `/reel/<code>/` client-redirects to `/reels/<code>/`: the same snap-scrolling
  viewer as the Reels tab (`scroll-snap-type: y mandatory`, two slides loaded,
  `div[role=toolbar][aria-label="Reels navigation controls"]` with
  "Navigate to next/previous Reel"). Native policy blocks exactly `/reels/` and
  `/reels/audio/…`; `/reels/<code>/` is allowed and pinned to one slide.
- `/explore/` grid tiles are `a[href^="/p/"]`; the search input is
  `input[aria-label="Search input"]`. Tapping it on phone navigates to
  `/explore/search/`. Hiding the grid alone left the infinite-scroll sentinel
  visible, so Instagram kept fetching pages that flashed before the observer hid
  them. Now: everything in `main` except the search box's ancestor chain is marked
  and hidden by route-scoped CSS (`html[data-gramini-route="explore"]`), and the
  remaining box is centred.
- Layout: the web view lives **inside** the safe area with
  `contentInsetAdjustmentBehavior = .never`. Full-bleed + automatic insets made the
  document 45 px taller than the viewport and WKWebView scrolled Instagram's fixed
  search header under the status bar when the keyboard opened.
- Debugging: DEBUG builds set `window.__graminiDebug`, `isInspectable`, and
  filter.js posts a structural probe that `xcrun devicectl device process launch
  --console` prints on the Mac. Nothing personal is included.

Verified on device: story ends and returns to the profile; single reel plays
without advancing; Explore search works. Not yet seen in testing: an in-feed
"Suggested for you" module or a Sponsored post; the activity page.

## Phase 3 — seen posts (2026-09-21)

- The phone feed is **not** virtualised (89 articles were in the DOM after
  Instagram fetched extra pages); desktop is. The logic handles both by keeping
  the set of codes that appeared before the stop and hiding everything else.
- Instagram's infinite-scroll loader (`svg[aria-label="Loading..."]` inside a
  `div[role=progressbar]`) sits **outside** the feed container. Hiding the
  after-stop articles alone left it visible, so more pages kept loading (spinner at
  the bottom). Its single-child wrapper is now hidden once the feed stops.
- Some post links carry 39-character codes (seen in the Following feed); the
  shortcode regex allows up to 64 chars and the native store validates the same.
- The seen list is published via a document-start user script that is rebuilt
  before every main-frame navigation (`refreshUserScripts()`), so a pull to
  refresh sees the posts from the previous page load.

## Selector changes

_(none yet)_

## Gaps found

_(none yet)_

## Test log

| Date | Build | Result |
|---|---|---|
| 2026-09-21 | phase 1, simulator | Launches, landing + login page render, in-app navigation OK. |
| 2026-09-21 | phase 2, iPhone 17 Pro | Login persists. Following feed, no Reels tab, no DM badge, Explore = search box only, search works, keyboard layout OK. Story stops at end; reel viewer pinned. |
| 2026-09-21 | phase 3, iPhone 17 Pro | Safety cap at 40 posts on fresh store; after relaunch the feed stopped at the first seen post with the end card and no spinner. |
