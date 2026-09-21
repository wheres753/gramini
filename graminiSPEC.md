# Gramini — Build Spec

A personal, private iPhone app (plus a matching Chrome extension) that shows Instagram's website with the addictive parts removed. For one user only, distributed through **internal TestFlight**. Never submitted to the App Store and never shared.

**Goal:** keep posting, activity (likes/comments), search for friends, friends' posts, and DMs as a backup. Remove Reels browsing, Explore, the Stories bar, suggested and sponsored content, and endless scrolling.

---

## 1. Environment

| Item | Value |
|---|---|
| iPhone | iPhone 17 Pro, iOS 26.6.2 |
| Mac | MacBook Air M4, macOS 26.6.2 |
| Xcode | 26.5 |
| Apple Developer | Individual, Team ID `YOURTEAMID` (user is Account Holder) |
| Bundle ID | `com.wheres753.gramini` |
| Tools installed | Homebrew 6.0.5, Claude Code 2.1.128, git 2.50.1 |
| Source control | Private GitHub repo `gramini` |
| Distribution | Internal TestFlight only (no beta review) |
| Instagram account | Password login on Instagram's own page |
| Desktop browser | Chrome |

- Deployment target: iOS 26.0. Swift 6, SwiftUI, WKWebView.
- Generate the Xcode project with **XcodeGen** (`brew install xcodegen`) from `project.yml` so Claude Code can edit the project as text. Don't commit `Gramini.xcodeproj`.

---

## 2. Principles (non-negotiable)

1. **No remote code.** The filter script is bundled in the app and the extension. Nothing is downloaded and run at runtime. To update the filter, ship a new build.
2. **Display-only changes.** The app only hides and rearranges what's on screen. It never clicks, scrolls, likes, follows or fetches anything automatically, uses no private API calls, and never scrapes. All network traffic is what instagram.com itself makes.
3. **The password is only ever typed into Instagram's own login page.** The app never reads, stores or injects credentials.
4. **Fail closed on attention traps and open on everything else.** If a selector breaks, Reels and Explore routes must still be blocked (route-based). Feed filtering may degrade to showing too much, but never to a blank app.
5. **All selectors live in one config object** at the top of `filter.js`, using structural hooks (`href`, `role`, `aria-label`, visible text such as "Suggested for you" or "Sponsored") rather than Instagram's obfuscated class names.

---

## 3. Features and behavior

### 3.1 Home feed: Following, newest first
- On launch, load the Following feed. Try `https://www.instagram.com/?variant=following` first. If that no longer works, the script selects "Following" in the feed switcher once on load. **Verify at build time.**
- If Instagram ever returns to the algorithmic Home feed, the script switches it back to Following.
- Hide the feed-type switcher so the For You feed can't be selected.

### 3.2 Stop at already-seen posts
- Identify each post by its shortcode from the post's `/p/<code>/` or `/reel/<code>/` link.
- A post counts as **seen** once at least 60% of it has been visible for at least 1.5 seconds. Keep seen shortcodes in the app's storage: native, through a `WKScriptMessageHandler`, stored in a JSON file in Application Support, keeping the most recent 2,000.
- When the feed reaches the **first post that is already seen**, hide it and every post after it. Show an end card: **"You're caught up."** It has no "load more" button.
- **Safety cap:** if no seen post appears (first run, or a very long gap), stop at the first post older than **3 days** (from the post's `<time datetime>`), or after **40 posts**, whichever comes first. Both values go in the config object.
- Pull to refresh reloads the Following feed. New posts appear above the end card.

### 3.3 Stories
- Hide the **Stories bar at the top of the feed**.
- Stories can still be viewed by tapping the ring on a friend's profile picture on their profile page.
- The story viewer must not auto-advance to other people's stories. When a story finishes, close the viewer and return to the profile.

### 3.4 Reels
- Reels **posted by people you follow appear in the feed as normal**.
- Hide the Reels tab in the navigation. Any navigation to `/reels/` redirects to the feed.
- Opening a single reel (`/reel/<code>/`) plays that one only. Swiping or auto-advancing to another reel is blocked, and the viewer returns to where it was opened from.

### 3.5 Search and Explore
- Keep the **search box and its results** (accounts, tags, places) so you can find friends' profiles.
- Hide the **Explore grid** on `/explore/`. The page shows only the search box with an empty state below it.
- Hide Reels and suggested content inside search results and on tag and place pages.

### 3.6 Suggested and sponsored content
- Hide "Suggested for you" modules, suggested posts, suggested accounts and sponsored posts everywhere.
- Hide "Open in app" banners and prompts to get the app.

### 3.7 Activity
- Keep the notifications and activity page (likes, comments, follows) reachable from the navigation.
- Hide suggested accounts on that page.

### 3.8 Posting
- All posting features the web version supports: choosing from the camera roll, single or multiple photos and videos (carousels), cropping, filters, captions, tagging people, location and alt text.
- The WKWebView must support `<input type=file>` uploads from the photo library, and add `NSPhotoLibraryUsageDescription` and `NSCameraUsageDescription` to Info.plist.
- **Known limit:** some app-only features, such as adding music to a post, may not exist on the web version. Record any gaps found in testing in `NOTES.md`.

### 3.9 DMs (backup only)
- Keep DMs available but quiet: hide the unread-count badge on the Messages icon. DM notifications come through Beeper.

### 3.10 20-minute daily limit (iPhone)
- The limit is tracked in native Swift code, not in JavaScript. Time counts only while the app is in the foreground and active.
- Store it in `UserDefaults`, keyed by local date. It resets at local midnight.
- With 2 minutes left, show a small non-blocking banner.
- At 20:00, remove the web view and show a full-screen "That's it for today" screen with the time until midnight. **No override.**
- A small time-used readout appears when you long-press the app header. It's hidden otherwise.

### 3.11 Links and navigation
- Only `instagram.com`, `*.instagram.com`, `*.cdninstagram.com` and `*.fbcdn.net` load inside the app, along with whatever Meta login and checkpoint domains the login flow needs (identify these during testing).
- Every other link opens in Safari.
- No back and forward chrome. A swipe from the edge goes back.

### 3.12 App shell
- Full-screen WKWebView with a mobile Safari user agent, and a persistent `WKWebsiteDataStore.default()` so the login persists.
- Inject `filter.css` at document start and `filter.js` at document end, in all frames.
- A `MutationObserver` re-applies the filters, debounced. Nothing scans the whole page on a timer.
- Handle safe areas and Dark Mode (follow the system setting).

---

## 4. Chrome extension (desktop)

- Manifest V3, a content script on `https://www.instagram.com/*`, loaded unpacked through `chrome://extensions` in Developer mode. Not published to the Chrome Web Store.
- **Shares the same `filter.js` and `filter.css`** as the iOS app. Only platform differences (desktop selectors, left sidebar) go in a separate config block.
- Same rules: Following by default, no Stories bar, Reels tab and Explore grid hidden with the search box kept, no suggested or sponsored content, and a stop at already-seen posts.
- Seen posts are stored in `chrome.storage.local`. They are **not synced** with the phone, which is fine.
- **Daily limit on desktop:** not included in the first version. See open questions.

---

## 5. Repository layout

```
gramini/
├── SPEC.md
├── NOTES.md                 # selector changes, gaps found, test log
├── project.yml              # XcodeGen
├── ios/
│   ├── Sources/
│   │   ├── GraminiApp.swift
│   │   ├── RootView.swift        # switches between web view and limit screen
│   │   ├── WebView.swift         # WKWebView, injection, navigation policy
│   │   ├── SeenStore.swift       # seen-post shortcodes (JSON)
│   │   ├── UsageLimiter.swift    # 20-min daily timer
│   │   └── Assets.xcassets/      # app icon
│   └── Info.plist
├── shared/
│   ├── filter.js            # CONFIG object at the top
│   └── filter.css
├── chrome/
│   ├── manifest.json
│   └── (filter.js, filter.css copied in by the sync script)
├── scripts/
│   └── sync-filter.sh       # copies shared/ into ios bundle + chrome/
└── ci_scripts/
    └── ci_post_clone.sh     # Xcode Cloud: install xcodegen, generate project
```

---

## 6. App icon

- Name on the home screen: **Gramini**.
- An **original** mark with a clean, outdoorsy, vintage-sportswear feel: a bold rounded lowercase "g" in dark forest green on a warm cream background, with a small solid half-sun sitting on the g's baseline.
- It must not use or imitate any existing brand's logo, figure or wordmark. `tools/gen_icon.py` generates the 1024×1024 PNG.

---

## 7. Build and release

### 7.1 One-time setup (done by the user)
1. **App Store Connect → Apps → + New App**: iOS, bundle ID `com.wheres753.gramini` (register it first at developer.apple.com → Certificates, IDs & Profiles → Identifiers). App Store names must be unique, so if "Gramini" is taken, use something like "Gramini Personal". The home-screen name can still be "Gramini".
2. **TestFlight → Internal Testing** → create a group and add yourself. Internal builds need no review.
3. Create the private GitHub repo `gramini` and push the code.

### 7.2 Keeping the build alive (TestFlight builds expire after 90 days)
- **Primary: Xcode Cloud.** It's included with the developer membership (25 compute hours a month).
  - Workflow "Monthly TestFlight": `main` branch, Archive (iOS), post-action **TestFlight Internal Testing** to the user's group.
  - Start conditions: on push to `main` **and** on a schedule. Pick the longest interval the scheduler offers that is 30 days or less (weekly is fine). Each run uploads a fresh build, which restarts the 90-day clock.
  - `ci_scripts/ci_post_clone.sh` installs XcodeGen and runs `xcodegen generate`.
  - The build number comes from `CI_BUILD_NUMBER`.
- **Fallback: GitHub Actions.** A macOS runner with a monthly cron, building with an App Store Connect API key stored in repo secrets and uploading with `xcrun altool` or fastlane.
- **Backup reminder:** a Claude scheduled task on the 1st of every other month to check that the latest TestFlight build is less than 60 days old.

### 7.3 Local development
- `xcodegen generate && open Gramini.xcodeproj`, then run on the iPhone over USB for quick testing (Developer Mode already on).

---

## 8. Test checklist (run on device before each release)

- [ ] Login persists across app restarts
- [ ] The app opens to the Following feed, newest first, with no feed switcher
- [ ] No Stories bar. A friend's story plays from their profile and stops at the end
- [ ] A followed account's reel plays in the feed. Swiping on an opened reel doesn't advance
- [ ] `/reels/` redirects. The Reels tab is gone
- [ ] Search finds a friend. No Explore grid
- [ ] No suggested or sponsored posts after scrolling the full feed
- [ ] The feed stops with "You're caught up" at the first seen post
- [ ] The safety cap triggers on a fresh install (clear the seen store)
- [ ] Post a carousel with 2 photos and 1 video from the camera roll, with a caption, tag and location
- [ ] The activity page shows likes and comments
- [ ] DMs open, with no unread badge
- [ ] External links open in Safari
- [ ] The 20-minute limit triggers, survives an app restart, and resets after midnight
- [ ] Chrome extension: the same feed, stories, reels, explore and seen behaviour on desktop

---

## 9. Known limits and risks

- **Instagram changes its website.** Filters will break sometimes. The fix is a selector update in `shared/filter.js`, then a push, which triggers an Xcode Cloud build.
- **No push notifications.** This is intended. Beeper handles DMs.
- **Screen Time:** don't add a Screen Time limit that covers the instagram.com website. It applies inside Gramini's web view too and would block the app.
- **Terms of Use:** personal, display-only use with no automation and no distribution keeps the risk low. Never add auto-actions.
- **Posting features** are limited to what the web version supports.

---

## 10. Open questions

1. Should the 20-minute limit also cover Chrome on the Mac, as a shared total or a separate 20 minutes?
2. After the limit, should posting still be allowed (for example, a "Post only" screen), or should everything be locked?
3. Does the login flow need to handle a 2FA prompt? The app shows Instagram's own login page either way, so this only affects which domains the allowlist needs.
