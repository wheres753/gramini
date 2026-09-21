// Gramini filter — shared by the iOS app (WKUserScript, document end, all
// frames) and the Chrome extension (content script).
//
// Rules of the road (see graminiSPEC.md §2):
//   * Display-only. Hide and rearrange. Never click, scroll, like, follow,
//     fetch, or call any Instagram API.
//   * Every selector lives in CONFIG below, using structural hooks (href, role,
//     aria-label, visible text) — never Instagram's obfuscated class names.
//   * Fail closed on attention traps (routes), open on everything else.
//   * Nothing scans the page on a timer. A debounced MutationObserver re-applies.
(function gramini() {
  'use strict';
  if (window.__gramini) return;          // injected once per frame
  window.__gramini = true;

  // ---------------------------------------------------------------------------
  // CONFIG — the only place selectors and tunables live.
  // ---------------------------------------------------------------------------
  const CONFIG = {
    // Debounce for the MutationObserver, ms.
    observerDebounceMs: 150,

    // Attribute stamped on hidden elements so filter.css can hide them and we
    // never re-process the same node.
    hiddenAttr: 'data-gramini-hidden',

    // "Open in app" / "Get the app" banners and interstitials. Hidden by
    // walking up from a matching anchor/button to a small container.
    openInApp: {
      anchors: [
        'a[href*="apps.apple.com"]',
        'a[href*="play.google.com"]',
        'a[href^="instagram://"]',
        'a[href*="itunes.apple.com"]',
        'a[href*="/download/"]',
      ],
      // Visible text of buttons/links that push the native app (lowercase).
      texts: ['open app', 'use app', 'use the app', 'get app', 'get the app',
              'open instagram', 'switch to the app', 'download app'],
      // How many ancestors to climb when looking for the banner container,
      // and the tallest thing that still counts as a banner (px). Anything
      // bigger is page content; we then hide only the button itself.
      maxClimb: 6,
      maxBannerHeight: 140,
    },

    // Anything containing one of these is page content, never a banner.
    protectedContent: 'article, main, nav, form, input, textarea, [role="main"], ' +
                      '[role="feed"], [role="navigation"], a[href*="/accounts/"]',

    // Platform-specific overrides (desktop selectors, left sidebar) go here in
    // phase 5. Keep shared rules above platform blocks.
    platform: {
      ios: {},
      chrome: {},
    },
  };

  // ---------------------------------------------------------------------------
  // Environment
  // ---------------------------------------------------------------------------
  const isIOS = !!(window.webkit && window.webkit.messageHandlers &&
                   window.webkit.messageHandlers.gramini);
  const isChrome = typeof chrome !== 'undefined' && !!(chrome.storage && chrome.storage.local);
  const PLATFORM = isIOS ? 'ios' : isChrome ? 'chrome' : 'web';

  function post(msg) {
    if (!isIOS) return;
    try { window.webkit.messageHandlers.gramini.postMessage(msg); } catch (_) {}
  }
  function log(message) {
    post({ type: 'log', message: String(message) });
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  function hide(el, reason) {
    if (!el || el.hasAttribute(CONFIG.hiddenAttr)) return;
    el.setAttribute(CONFIG.hiddenAttr, reason || '1');
  }

  function textOf(el) {
    return (el.textContent || '').trim().toLowerCase();
  }

  // Climb from `el` up to `maxClimb` ancestors and return the largest one that
  // still looks like a banner: laid out, short, few children, and free of page
  // content (feed, forms, navigation, login links). Worst case we hide only
  // `el` itself — never the page.
  function bannerContainer(el, cfg) {
    let node = el;
    let best = el;
    for (let i = 0; i < cfg.maxClimb && node && node.parentElement; i++) {
      node = node.parentElement;
      if (node === document.body || node === document.documentElement) break;
      if (node.children.length > 3) break;
      if (node.querySelector(CONFIG.protectedContent)) break;
      const h = node.getBoundingClientRect().height;
      if (h === 0 || h > cfg.maxBannerHeight) break;
      best = node;
    }
    return best;
  }

  // ---------------------------------------------------------------------------
  // Rules
  // ---------------------------------------------------------------------------
  function applyOpenInApp(root) {
    const cfg = CONFIG.openInApp;
    const scope = root && root.querySelectorAll ? root : document;

    scope.querySelectorAll(cfg.anchors.join(',')).forEach(a => {
      hide(bannerContainer(a, cfg), 'open-in-app');
    });

    scope.querySelectorAll('a, button, [role="button"], [role="link"]').forEach(el => {
      if (el.hasAttribute(CONFIG.hiddenAttr)) return;
      const t = textOf(el);
      if (t.length > 40) return;                       // not a button label
      if (cfg.texts.some(x => t === x || t.startsWith(x))) {
        hide(el, 'open-in-app');                        // the control only, never its wrapper
      }
    });
  }

  function applyAll(root) {
    try { applyOpenInApp(root); } catch (e) { log('openInApp: ' + e); }
    // Phase 2: feed, stories, reels, explore, suggested/sponsored, DM badge.
    // Phase 3: seen-post tracking + end card.
  }

  // ---------------------------------------------------------------------------
  // Observer — debounced, no timers otherwise
  // ---------------------------------------------------------------------------
  let pending = null;
  const observer = new MutationObserver(() => {
    if (pending) return;
    pending = setTimeout(() => {
      pending = null;
      applyAll(document);
    }, CONFIG.observerDebounceMs);
  });

  function start() {
    applyAll(document);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    log('filter.js active on ' + PLATFORM + ' at ' + location.pathname);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
