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

## Phase 4 — daily limit (2026-09-21)

- `UsageLimiter` counts only while the scene phase is `.active`; the running
  session is folded into `usedToday` on resign, persisted every 5 s and on every
  phase change (`usage.date` / `usage.seconds` in UserDefaults, local-date key).
  Midnight rollover is checked on every tick, so the lock screen releases itself.
- Spec §10 Q2 answered by default: after the limit **everything** is locked (the
  web view is removed from the hierarchy). Change `RootView` if "post only" is
  wanted later.
- Banner: last 2 minutes, top capsule, `allowsHitTesting(false)`.
- Readout: long press on the top 60 pt of the web view (Instagram's header).
  A SwiftUI strip over the status bar never receives touches, and a plain
  `UILongPressGestureRecognizer` loses to WebKit's text-selection press, so
  `HeaderPressRecognizer` fails at touch-down outside the header and WebKit's
  long-press recognizers are required to wait for it inside.
- DEBUG launch arguments: `-GraminiLimitSeconds 150` shortens the limit,
  `-GraminiResetUsage YES` clears today's tally.
- Verified in the simulator with a 150 s limit: banner at 2:00 left, lock at
  0:00, still locked after relaunch, readout on header long press.

## Phase 5 — Chrome extension (2026-09-21)

- MV3, content script on `https://www.instagram.com/*`, `storage` permission,
  `all_frames`. `chrome/filter.{js,css}` are copies made by
  `scripts/sync-filter.sh` (`--check` verifies they are current). Loaded unpacked.
- Verified in Chrome: Following redirect, Reels rail entry gone, sidebar
  "Suggested for you" gone (profile row and footer intact), DM badge gone, Explore
  reduced to the search box. Seen posts go to `chrome.storage.local` (1 s timeout
  → fail open if storage is unavailable).
- Desktop limit: not included (spec §4).

## Fixes from device testing (2026-09-21)

- Instagram drops its tab bar on `/direct/inbox/` on phones. filter.js now draws
  a four-link bar (Home → Following, Search, Messages, Profile) on
  `/direct/inbox/` and `/direct/requests/` only — not in threads, where it would
  cover the composer. Profile href is learned from Instagram's bar and kept in
  `localStorage`. Lesson: the bar's own `a[href="/explore/"]` matched the probe
  for Instagram's bar, causing an add/remove loop that flashed; the probe now
  excludes `.gramini-nav`.
- Posts flashed for ~150 ms before being hidden after the stop. On the home route
  `article:not([data-gramini-ok])` is `visibility: hidden` until the seen rule
  approves it; the observer also checks the route synchronously so the rule is in
  place before an SPA transition renders the feed. Debounce lowered to 60 ms. If
  the seen rule throws, every article is revealed (fail open).

## Phase 6 — Xcode Cloud (2026-09-21)

Committed:
- `ci_scripts/ci_post_clone.sh` — installs XcodeGen, stamps `CURRENT_PROJECT_VERSION`
  with `CI_BUILD_NUMBER`, generates `Gramini.xcodeproj`, checks `chrome/` is in sync.
- `.github/workflows/testflight.yml` — fallback, `workflow_dispatch` only until its
  secrets exist (App Store Connect API key + Apple Distribution .p12). Enable the
  cron there if Xcode Cloud ever stops being an option.
- A local Release archive (`xcodebuild … archive`) succeeds with automatic signing.

One-time setup in Xcode (needs the project open: `GRAMINI_TEAM_ID=<team> xcodegen generate && open Gramini.xcodeproj`):
1. App Store Connect: register bundle ID `com.wheres753.gramini`, create the app,
   TestFlight → Internal Testing → group with yourself.
2. Xcode → Product → Xcode Cloud → Create Workflow… → product Gramini.
3. Grant Xcode Cloud access to the GitHub repo `wheres753/gramini` when prompted.
4. Workflow "Monthly TestFlight": Environment Xcode 26.x; Start Conditions =
   Branch Changes on `main` **and** Scheduled (weekly, or the longest interval
   ≤ 30 days offered); Actions = Archive iOS, deployment preparation
   "TestFlight (Internal Testing Only)"; Post-Actions = TestFlight Internal
   Testing → your group. Under Environment → Environment Variables add
   `GRAMINI_TEAM_ID` = your Team ID — `project.yml` reads
   `DEVELOPMENT_TEAM` from the environment so the ID is not in the repo, and
   `ci_post_clone.sh` exits 1 without it.
5. Start the first build manually; check the log shows `ci_post_clone.sh`
   installing XcodeGen and `CURRENT_PROJECT_VERSION: "<n>"`.
6. On the phone, install TestFlight, accept the invite, install Gramini from it.

Done 2026-09-21: workflow **Updater** — Branch Changes on `main` + weekly schedule
(Sunday 00:00 America/Vancouver), Archive iOS with TestFlight (Internal Testing
Only) preparation, post-action TestFlight Internal Testing → group `graminers`.
Builds 1–2 (archive only) passed on Xcode Cloud (Xcode 27 image); Build 3 is the
first with the TestFlight upload. In Xcode 26 the menu is **Integrate**, not
Product; a workflow can also be edited by right-clicking it in the Report
navigator's Cloud tab.
   The Xcode-installed Debug build can then be deleted (same bundle ID; TestFlight
   replaces it, and the login lives in the shared website data store either way —
   but the seen list and usage tally are per-install, so expect a fresh start).

## Icon change (2026-09-21)

Sam preferred a figure over the "g" from spec §6. `tools/gen_icon.py` now draws an
original striding/leaping figure in forest green on cream, no sun. It is built
from thick rounded strokes only and deliberately shares no pose, proportions or
detail with any brand's running-figure mark. Spec §6 still describes the "g".

## Selector changes

_(none yet)_

## Gaps found

_(none yet)_

## Test log

| Date | Build | Result |
|---|---|---|
| 2026-09-21 | phase 1, simulator | Launches, landing + login page render, in-app navigation OK. |
| 2026-09-21 | phase 2, iPhone 17 Pro | Login persists. Following feed, no Reels tab, no DM badge, Explore = search box only, search works, keyboard layout OK. Story stops at end; reel viewer pinned. |
| 2026-09-21 | phase 5, Chrome + iPhone | Extension loaded unpacked; desktop rules verified. Inbox tab bar and no-flash feed verified on device. |
| 2026-09-21 | phase 4, simulator | 150 s limit: banner, lock screen, lock survives relaunch, header long-press readout. Midnight reset not yet observed. |
| 2026-09-21 | phase 3, iPhone 17 Pro | Safety cap at 40 posts on fresh store; after relaunch the feed stopped at the first seen post with the end card and no spinner. |

2026-11-06: repo made public. The Apple Developer Team ID is no longer in
`project.yml` — it comes from `GRAMINI_TEAM_ID` in the environment (see
"Keep the build alive" in the README). `GRAMINI_TEAM_ID` is set as an
environment variable on the **Updater** workflow; without it `ci_post_clone.sh`
exits 1. Git history was rewritten the same day to drop the Team ID, the old
commit email and the recorded 2FA state, so every commit SHA before this point
changed; re-clone rather than pulling into an old checkout.

Also found that day: Xcode Cloud had been silently idle since build 11
(Oct 25) because the updated Apple Developer Program License Agreement needed
accepting — the weekly schedule just stopped rather than failing. Accepted it,
then build 12 (manual, commit 8ddf191) archived and signed clean in ~4 min, so
the environment-variable setup is verified end to end.
