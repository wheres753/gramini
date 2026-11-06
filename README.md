# Gramini

A personal iPhone app (plus a Chrome extension) that shows Instagram's website
with the addictive parts removed. Keep posting, likes and comments, search for
friends, friends' posts and DMs. Lose Reels browsing, Explore, the Stories bar,
suggested and sponsored content, and endless scrolling — the feed stops at the
first post you've already seen, and the app locks after 20 minutes a day.

It is a display-only wrapper: a `WKWebView` showing instagram.com with a bundled
script that hides and rearranges what's on screen. It never clicks, likes,
follows or fetches anything on its own, uses no private API, and never sees your
password — you log in on Instagram's own page. Full design in
[graminiSPEC.md](graminiSPEC.md); decisions, selectors and test log in
[NOTES.md](NOTES.md).

Not on the App Store and not meant to be. Run your own copy.

## What you need

- A Mac with Xcode 26 or newer and [Homebrew](https://brew.sh).
- An iPhone on iOS 26 or newer.
- An Apple Developer account. A free one runs the app from Xcode (re-install
  every 7 days); the paid membership gives you TestFlight builds that last 90
  days and Xcode Cloud to refresh them automatically.

## Run it on your iPhone

1. Clone the repo and install XcodeGen:
   ```bash
   brew install xcodegen
   ```
2. Open `project.yml` and change `bundleIdPrefix` near the top to a reverse-DNS
   prefix you own (e.g. `com.yourname`), and `PRODUCT_BUNDLE_IDENTIFIER` to
   match.
3. Generate and open the project, passing your Apple Developer Team ID
   (developer.apple.com → Membership). It is read from the environment rather
   than committed, so export it in your shell profile if you don't want to
   repeat it:
   ```bash
   GRAMINI_TEAM_ID=YOURTEAMID xcodegen generate && open Gramini.xcodeproj
   ```
   Re-run this whenever you change `project.yml`. If `GRAMINI_TEAM_ID` is
   unset, XcodeGen writes the literal `${GRAMINI_TEAM_ID}` into the project and
   Xcode fails to sign.
4. In Xcode: sign in (Xcode → Settings → Accounts), plug in the iPhone, pick
   it as the run destination, press ⌘R. On the phone, trust the developer
   certificate when asked (Settings → General → VPN & Device Management).
5. Log in to Instagram in the app. That's it.

`Gramini.xcodeproj` is generated and not committed — edit `project.yml` instead.

## Keep the build alive (optional, paid membership)

TestFlight builds expire after 90 days, so the repo includes an Xcode Cloud
setup that re-uploads a build weekly and on every push to `main`:

1. App Store Connect: register your bundle ID, create the app, add yourself to
   a TestFlight **internal** group (no review needed).
2. In Xcode: **Integrate → Create Workflow…**, connect the repo, then set
   start conditions (branch `main` + a weekly schedule), the Archive action's
   distribution preparation to *TestFlight (Internal Testing Only)*, and a
   *TestFlight Internal Testing* post-action to your group.
3. Add `GRAMINI_TEAM_ID` (your Team ID) as an environment variable on the
   workflow: App Store Connect → Xcode Cloud → Manage Workflows → Environment
   → Environment Variables. The build fails fast without it.
4. `ci_scripts/ci_post_clone.sh` installs XcodeGen and generates the project on
   the build machine; the build number comes from Xcode Cloud.

A GitHub Actions fallback lives in `.github/workflows/testflight.yml`; it needs
the secrets listed at the top of that file.

## Chrome extension

Same filter, same behaviour on the desktop site (no daily limit there).

1. `scripts/sync-filter.sh` copies `shared/` into `chrome/` (the copies are
   committed; run it after editing the filter).
2. Chrome → `chrome://extensions` → Developer mode → **Load unpacked** →
   choose the `chrome/` folder.

## Layout

| Path | What |
|---|---|
| `shared/filter.js`, `shared/filter.css` | The filter. All selectors live in the `CONFIG` object at the top of `filter.js`. |
| `ios/Sources/` | SwiftUI shell: web view, seen-post store, daily limit. |
| `chrome/` | Extension manifest + copies of the shared filter. |
| `scripts/sync-filter.sh` | Keeps `chrome/` in sync with `shared/`. |
| `ci_scripts/ci_post_clone.sh` | Xcode Cloud bootstrap. |
| `tools/gen_icon.py` | Draws the app icon. |

## When Instagram changes its site

Something will stop being hidden. Fix the selector in `shared/filter.js`
(structural hooks only — `href`, `role`, `aria-label`, visible text; never
Instagram's generated class names), run `scripts/sync-filter.sh`, push. Debug
builds print a structural probe of the page to the console, which makes finding
the new hook quick; see NOTES.md → "Debugging".

## Privacy and safety

- No remote code: the filter is bundled; updating it means shipping a build.
- No network calls of its own. Everything on the wire is instagram.com's.
- Stored on the device: Instagram's session cookies (in the app's own sandbox),
  the shortcodes of posts you've seen, and today's usage in seconds.
- Attention-trap routes (`/reels/`) are blocked natively as well as in the
  script, so a broken selector can't reopen them; everything else fails open so
  the app never goes blank.

Personal, non-commercial use. Don't add automation.
