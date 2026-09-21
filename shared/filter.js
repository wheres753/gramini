// Gramini filter — shared by the iOS app (WKUserScript, document end, all
// frames) and the Chrome extension (content script).
//
// Rules of the road (see graminiSPEC.md §2):
//   * Display-only. Hide and rearrange. Never click, scroll, like, follow,
//     fetch, or call any Instagram API. The only navigation this script ever
//     performs is leaving an attention trap (Reels tab, auto-advanced reel or
//     story, the For You feed) for the Following feed or the page it came from.
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
    observerDebounceMs: 150,

    // Attributes stamped on elements; filter.css acts on them.
    hiddenAttr: 'data-gramini-hidden',   // display: none
    inertAttr:  'data-gramini-inert',    // pointer-events: none (visible, not tappable)
    lockAttr:   'data-gramini-lock',     // overflow hidden, no scroll snapping
    routeAttr:  'data-gramini-route',    // on <html>: home | explore | explore-sub | reel | story | other

    // Where attention traps send you.
    followingURL: '/?variant=following',

    routes: {
      home:        /^\/$/,
      // Fail closed: these always bounce to the Following feed.
      blocked:     [/^\/reels\/$/, /^\/reels\/audio\//],
      // Single-reel viewer (/reel/<code>/ client-redirects here).
      reelViewer:  /^\/reels?\/([A-Za-z0-9_-]+)\/?$/,
      storyViewer: /^\/stories\/([^/]+)\//,
      explore:     /^\/explore\/?$/,
      exploreSub:  /^\/explore\/./,        // tags, locations, search results
    },

    // Shortcode extraction from post links: /p/<code>/, /reel/<code>/,
    // /<user>/p/<code>/, /reels/<code>/. "audio" and "highlights" are not codes.
    postLink: /\/(p|reels?)\/([A-Za-z0-9_-]+)\/?(?:[?#]|$)/,
    notCodes: ['audio', 'highlights'],

    feed: {
      // Leaf text of the header title when the Following feed is active.
      followingTitle: 'Following',
      // Feed-type switcher entries (a dropdown or a row of tabs).
      switcherTexts: ['For you', 'Following', 'Favorites'],
      // Instagram's own divider; everything after it is suggested content.
      caughtUpText: /^You'?re all caught up$/i,
      // Automatic redirects to the Following feed are rate-limited so a site
      // change can never produce a reload loop.
      redirectCooldownMs: 4000,
      redirectMaxPerMinute: 4,
    },

    nav: {
      // Navigation entries removed entirely.
      hideLinks: ['a[href="/reels/"]'],
      // Links to "/" (the Home tab, the feed title's back arrow) are pointed at
      // the Following feed instead, so a tap never lands on For You.
      homeLinks: 'a[href="/"]',
      // Unread-count badge on Messages. Matched by aria-label, then verified to
      // be a small numeric badge before hiding.
      dmBadge: '[aria-label^="Direct messaging"], a[href^="/direct/"] span',
    },

    stories: {
      // Items in the stories tray on the home feed. The tray is the ancestor
      // holding at least `minItems` of them (a <ul> on desktop, a <div> on phones).
      items: '[aria-label^="Story by"], [aria-label^="Your story"], [aria-label^="Add to your story"]',
      minItems: 2,
    },

    reelsViewer: {
      toolbar: '[role="toolbar"][aria-label*="Reels navigation"]',
    },

    explore: {
      tiles: 'a[href*="/p/"], a[href*="/reel/"], a[href*="/reels/"]',
      reelTiles: 'a[href*="/reel/"], a[href*="/reels/"]',
      searchInput: 'input[aria-label*="Search" i], input[placeholder*="Search" i]',
      // The page region that holds the grid and its infinite-scroll loader.
      content: 'main, [role="main"]',
    },

    suggested: {
      // Leaf text that marks a module or post as suggested/sponsored.
      moduleTexts: [/^Suggested for you$/i, /^Suggested posts?$/i, /^Suggested reels?$/i,
                    /^Suggested accounts?$/i, /^Accounts you might like$/i, /^Sponsored$/i,
                    /^Paid partnership/i],
      // How far a module may extend before we assume we've hit page structure.
      maxChildren: 6,
      maxViewportFraction: 0.7,
    },

    openInApp: {
      anchors: ['a[href*="apps.apple.com"]', 'a[href*="play.google.com"]',
                'a[href^="instagram://"]', 'a[href*="itunes.apple.com"]'],
      texts: ['open app', 'use app', 'use the app', 'get app', 'get the app',
              'open instagram', 'switch to the app', 'download app'],
      maxClimb: 6,
      maxBannerHeight: 140,
    },

    // Anything containing one of these is page content, never a banner/module.
    protectedContent: 'article, main, nav, header, footer, form, input, textarea, ' +
                      '[role="main"], [role="feed"], [role="navigation"], a[href*="/accounts/"]',

    // Platform-specific overrides (desktop selectors, left sidebar). Shared
    // rules above already cover both layouts; keep this block small.
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
  const DEBUG = !!window.__graminiDebug;
  const isTop = window === window.top;

  function post(msg) {
    if (!isIOS) return;
    try { window.webkit.messageHandlers.gramini.postMessage(msg); } catch (_) {}
  }
  function log(message) {
    post({ type: 'log', message: String(message) });
    if (DEBUG && !isIOS) console.log('[gramini]', message);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  function hide(el, reason) {
    if (!el || el === document.body || el === document.documentElement) return;
    if (el.hasAttribute(CONFIG.hiddenAttr)) return;
    el.setAttribute(CONFIG.hiddenAttr, reason || '1');
  }
  function textOf(el) { return (el.textContent || '').trim(); }
  function isLeaf(el) { return el.children.length === 0; }
  function leaves(root, tags) {
    return Array.from((root || document).querySelectorAll(tags || 'span,div,h1,h2,h3,h4,a,p'))
      .filter(isLeaf);
  }
  function hasProtected(el) { return !!el.querySelector(CONFIG.protectedContent); }

  // The navigation "item" around a nav link: climb through single-child
  // wrappers (Instagram wraps each entry in several) and stop at the list.
  function navItem(link) {
    let node = link;
    while (node.parentElement && node.parentElement.children.length === 1 &&
           node.parentElement !== document.body) {
      node = node.parentElement;
    }
    return node;
  }

  // Climb from a leaf to the module that contains it: the highest ancestor
  // that is still free of page structure and not implausibly large. Used for
  // "Suggested for you" blocks wherever they appear.
  function moduleContainer(leaf, cfg) {
    let node = leaf;
    const maxH = innerHeight * cfg.maxViewportFraction;
    while (node.parentElement && node.parentElement !== document.body) {
      const p = node.parentElement;
      if (hasProtected(p)) break;
      if (p.children.length > cfg.maxChildren) break;
      const h = p.getBoundingClientRect().height;
      if (h > maxH) break;
      node = p;
    }
    return node;
  }

  // Banner container for "open in app" prompts: laid out, short, few children,
  // no page content. Worst case we hide only `el` itself — never the page.
  function bannerContainer(el, cfg) {
    let node = el;
    let best = el;
    for (let i = 0; i < cfg.maxClimb && node && node.parentElement; i++) {
      node = node.parentElement;
      if (node === document.body || node === document.documentElement) break;
      if (node.children.length > 3) break;
      if (hasProtected(node)) break;
      const h = node.getBoundingClientRect().height;
      if (h === 0 || h > cfg.maxBannerHeight) break;
      best = node;
    }
    return best;
  }

  // The feed-level container that holds an element: the ancestor whose
  // siblings include <article>s. Null when not in a feed.
  function feedItem(el) {
    let node = el;
    while (node && node.parentElement && node.parentElement !== document.body) {
      const p = node.parentElement;
      if (Array.from(p.children).some(c => c.tagName === 'ARTICLE')) return node;
      node = p;
    }
    return null;
  }

  function shortcodeFromHref(href) {
    const m = CONFIG.postLink.exec(href || '');
    if (!m || CONFIG.notCodes.includes(m[2])) return null;
    return m[2];
  }

  // ---------------------------------------------------------------------------
  // Routing — fail closed on attention traps. Only the top frame navigates.
  // ---------------------------------------------------------------------------
  let lastHref = null;
  const viewerState = { reelCode: null, reelReturn: null, storyOwner: null };

  function goToFollowing(why) {
    const now = Date.now();
    let times = [];
    try { times = JSON.parse(sessionStorage.getItem('gramini.redirects') || '[]'); } catch (_) {}
    times = times.filter(t => now - t < 60000);
    const last = times.length ? times[times.length - 1] : 0;
    if (now - last < CONFIG.feed.redirectCooldownMs || times.length >= CONFIG.feed.redirectMaxPerMinute) {
      log('redirect suppressed (rate limit): ' + why);
      return false;
    }
    times.push(now);
    try { sessionStorage.setItem('gramini.redirects', JSON.stringify(times)); } catch (_) {}
    log('redirect -> following: ' + why);
    location.replace(CONFIG.followingURL);
    return true;
  }

  function onRoute(prevPath) {
    const path = location.pathname;
    const R = CONFIG.routes;

    if (R.blocked.some(re => re.test(path))) {
      goToFollowing('blocked route ' + path);
      return;
    }

    // Home must be the Following feed. Instagram keeps ?variant=following in
    // the URL while it is active (verified 2026-09-21 on desktop).
    if (R.home.test(path) && !/[?&]variant=following/.test(location.search)) {
      goToFollowing('home without variant');
      return;
    }

    // Single-reel viewer: remember which reel was opened and from where. If the
    // viewer moves on to another reel by itself, go back where we came from.
    const reel = R.reelViewer.exec(path);
    if (reel) {
      const code = reel[1];
      const cameFromViewer = prevPath && R.reelViewer.test(prevPath);
      if (!cameFromViewer) {
        viewerState.reelCode = code;
        viewerState.reelReturn = prevPath || null;
      } else if (viewerState.reelCode && code !== viewerState.reelCode) {
        log('reel advanced ' + viewerState.reelCode + ' -> ' + code + '; returning');
        location.replace(viewerState.reelReturn || CONFIG.followingURL);
        return;
      }
    } else {
      viewerState.reelCode = null;
    }

    // Story viewer: stay on the person whose story was opened.
    const story = R.storyViewer.exec(path);
    if (story) {
      const owner = decodeURIComponent(story[1]);
      const cameFromViewer = prevPath && R.storyViewer.test(prevPath);
      if (!cameFromViewer) {
        viewerState.storyOwner = owner;
      } else if (viewerState.storyOwner && owner !== viewerState.storyOwner) {
        log('story advanced ' + viewerState.storyOwner + ' -> ' + owner + '; returning to profile');
        location.replace('/' + encodeURIComponent(viewerState.storyOwner) + '/');
        return;
      }
    } else {
      viewerState.storyOwner = null;
    }
  }

  function routeName() {
    const R = CONFIG.routes, path = location.pathname;
    if (R.home.test(path)) return 'home';
    if (R.explore.test(path)) return 'explore';
    if (R.exploreSub.test(path)) return 'explore-sub';
    if (R.reelViewer.test(path)) return 'reel';
    if (R.storyViewer.test(path)) return 'story';
    return 'other';
  }

  function checkRoute() {
    if (!isTop) return;
    const name = routeName();
    if (document.documentElement.getAttribute(CONFIG.routeAttr) !== name) {
      document.documentElement.setAttribute(CONFIG.routeAttr, name);
    }
    if (location.href === lastHref) return;
    const prev = lastHref ? new URL(lastHref).pathname : null;
    lastHref = location.href;
    onRoute(prev);
  }

  // ---------------------------------------------------------------------------
  // Rules
  // ---------------------------------------------------------------------------
  function applyNav() {
    const cfg = CONFIG.nav;
    document.querySelectorAll(cfg.hideLinks.join(',')).forEach(a => hide(navItem(a), 'nav-reels'));
    document.querySelectorAll(cfg.homeLinks).forEach(a => a.setAttribute('href', CONFIG.followingURL));

    document.querySelectorAll(cfg.dmBadge).forEach(el => {
      if (el.hasAttribute(CONFIG.hiddenAttr)) return;
      const t = textOf(el);
      const r = el.getBoundingClientRect();
      // A badge is tiny and shows a count (or nothing but a dot).
      if (r.width <= 40 && r.height <= 40 && (/^\d{0,3}$/.test(t) || /^\d+\+$/.test(t))) {
        hide(el, 'dm-badge');
      }
    });
  }

  function applyFeed() {
    if (!CONFIG.routes.home.test(location.pathname)) return;
    const cfg = CONFIG.feed;

    // Stories tray: the ancestor holding several story items, plus the
    // single-child wrappers around it.
    const items = document.querySelectorAll(CONFIG.stories.items);
    if (items.length >= CONFIG.stories.minItems) {
      let tray = items[0];
      while (tray.parentElement && tray.parentElement !== document.body &&
             tray.querySelectorAll(CONFIG.stories.items).length < items.length) {
        tray = tray.parentElement;
      }
      while (tray.parentElement && tray.parentElement !== document.body &&
             tray.parentElement.children.length === 1 && !hasProtected(tray.parentElement)) {
        tray = tray.parentElement;
      }
      if (!hasProtected(tray)) hide(tray, 'stories-tray');
    }

    // The header title "Following" is a link back to For You: make it inert.
    leaves(document, 'span,div,h1,h2').forEach(l => {
      if (textOf(l) !== cfg.followingTitle) return;
      const link = l.closest('a[href="/"], [role="button"], button');
      if (link && link.getBoundingClientRect().top < 120) link.setAttribute(CONFIG.inertAttr, 'feed-title');
    });

    // Any explicit feed switcher (tabs or a dropdown listing the feed types).
    leaves(document, 'span,div').forEach(l => {
      const t = textOf(l);
      if (!cfg.switcherTexts.includes(t)) return;
      const opt = l.closest('[role="menuitem"], [role="option"], [role="tab"], [role="menuitemradio"]');
      if (opt) hide(opt.closest('[role="menu"], [role="listbox"], [role="tablist"]') || opt, 'feed-switcher');
    });

    // Instagram's own "You're all caught up" divider: hide everything after it.
    leaves(document, 'span,div,h2,h3').forEach(l => {
      if (!cfg.caughtUpText.test(textOf(l))) return;
      const item = feedItem(l);
      if (!item) return;
      let sib = item.nextElementSibling;
      while (sib) { hide(sib, 'after-caught-up'); sib = sib.nextElementSibling; }
    });
  }

  function applySuggested() {
    const cfg = CONFIG.suggested;
    leaves(document, 'span,div,h2,h3,h4,a').forEach(l => {
      const t = textOf(l);
      if (t.length > 40 || !cfg.moduleTexts.some(re => re.test(t))) return;
      const article = l.closest('article');
      if (article) { hide(article, 'suggested-post'); return; }
      // Inside a feed, hide the feed-level item; elsewhere the module itself.
      const item = feedItem(l);
      hide(item || moduleContainer(l, cfg), 'suggested-module');
    });
  }

  function applyExplore() {
    const path = location.pathname;
    const cfg = CONFIG.explore;
    if (CONFIG.routes.explore.test(path)) {
      // Search stays; everything else in the content area goes — the grid and
      // its infinite-scroll loader, so nothing keeps fetching more tiles.
      document.querySelectorAll(cfg.tiles).forEach(t => hide(t, 'explore-tile'));
      const root = document.querySelector(cfg.content);
      if (!root) return;
      const input = root.querySelector(cfg.searchInput);
      if (!input) {
        // Search box not in the content area (or not rendered yet): hide the
        // content area's children that contain tiles or a loader.
        Array.from(root.children).forEach(c => {
          if (c.querySelector(cfg.tiles) || c.querySelector('svg[aria-label="Loading..."]')) hide(c, 'explore-grid');
        });
        return;
      }
      // Marked, not hidden outright: React reuses these nodes on
      // /explore/search/, where they must show. filter.css hides them only
      // while the route is /explore/.
      let node = input;
      while (node.parentElement && node !== root) {
        Array.from(node.parentElement.children).forEach(sib => {
          if (sib !== node && !sib.contains(input)) sib.setAttribute('data-gramini-explore-hide', '');
        });
        if (node.parentElement === root) node.setAttribute('data-gramini-explore-keep', '');
        node = node.parentElement;
      }
      root.setAttribute('data-gramini-explore', '');   // filter.css centres what is left
    } else if (CONFIG.routes.exploreSub.test(path)) {
      document.querySelectorAll(cfg.reelTiles).forEach(t => hide(t, 'explore-reel'));
    }
  }

  function applyReelViewer() {
    const m = CONFIG.routes.reelViewer.exec(location.pathname);
    if (!m) return;
    document.querySelectorAll(CONFIG.reelsViewer.toolbar).forEach(t => hide(t, 'reel-toolbar'));
    // The viewer is a snap-scrolling column of reels. Lock it and hide every
    // slide but the first so there is nothing to swipe to.
    document.querySelectorAll('div, section').forEach(el => {
      if (el.hasAttribute(CONFIG.lockAttr)) { trimSlides(el); return; }
      const cs = getComputedStyle(el);
      if (!/y mandatory|both mandatory/.test(cs.scrollSnapType)) return;
      if (el.scrollHeight <= el.clientHeight) return;
      el.setAttribute(CONFIG.lockAttr, 'reel-viewer');
      trimSlides(el);
    });
    function trimSlides(scroller) {
      Array.from(scroller.children).slice(1).forEach(c => hide(c, 'reel-next'));
    }
  }

  function applyOpenInApp() {
    const cfg = CONFIG.openInApp;
    document.querySelectorAll(cfg.anchors.join(',')).forEach(a => hide(bannerContainer(a, cfg), 'open-in-app'));
    document.querySelectorAll('a, button, [role="button"], [role="link"]').forEach(el => {
      if (el.hasAttribute(CONFIG.hiddenAttr)) return;
      const t = textOf(el).toLowerCase();
      if (t.length > 40) return;
      if (cfg.texts.some(x => t === x || t.startsWith(x))) hide(el, 'open-in-app');
    });
  }

  function applyAll() {
    checkRoute();
    const rules = [applyNav, applyFeed, applySuggested, applyExplore, applyReelViewer, applyOpenInApp];
    for (const rule of rules) {
      try { rule(); } catch (e) { log(rule.name + ': ' + e); }
    }
  }

  // ---------------------------------------------------------------------------
  // Debug probe — DEBUG builds only. Posts a structural summary (tags, roles,
  // aria-labels, hrefs; never post content) so selectors can be checked on the
  // phone without a web inspector.
  // ---------------------------------------------------------------------------
  function probe() {
    if (!DEBUG || !isTop) return;
    const short = s => (s || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    const desc = el => `<${el.tagName.toLowerCase()}` +
      (el.getAttribute('role') ? ' role=' + el.getAttribute('role') : '') +
      (el.getAttribute('aria-label') ? ' aria="' + short(el.getAttribute('aria-label')) + '"' : '') +
      (el.getAttribute('href') ? ' href=' + short(el.getAttribute('href')) : '') +
      (el.hasAttribute(CONFIG.hiddenAttr) ? ' HIDDEN' : '') + '>';
    const up = (el, n) => { const o = []; for (let i = 0; i < n && el && el !== document.body; i++) { o.push(desc(el) + ' k=' + el.children.length); el = el.parentElement; } return o.join(' < '); };
    const out = { path: location.pathname + location.search, w: innerWidth };
    out.navLinks = Array.from(new Set(Array.from(document.querySelectorAll('a[href="/"], a[href="/explore/"], a[href="/reels/"], a[href^="/direct/"], a[href*="/accounts/activity"], a[href="#"]'))
      .map(a => desc(a) + ' svg=' + (a.querySelector('svg') && a.querySelector('svg').getAttribute('aria-label')) + ' | ' + up(a.parentElement, 3))));
    out.svgLabels = Array.from(new Set(Array.from(document.querySelectorAll('svg[aria-label]')).map(s => s.getAttribute('aria-label')))).slice(0, 30);
    out.header = leaves(document, 'span,div,h1,h2').filter(l => /^(Following|For you|Home|Instagram)$/.test(textOf(l))).map(l => textOf(l) + ': ' + up(l, 5));
    out.stories = Array.from(document.querySelectorAll(CONFIG.stories.items)).slice(0, 1).map(s => up(s, 7));
    out.articles = document.querySelectorAll('article').length;
    out.hidden = Array.from(document.querySelectorAll('[' + CONFIG.hiddenAttr + ']')).map(e => {
      const why = e.getAttribute(CONFIG.hiddenAttr);
      return why + ':' + e.tagName.toLowerCase() + (why === 'open-in-app' ? '(' + short(e.textContent) + ')' : '');
    });
    out.inert = document.querySelectorAll('[' + CONFIG.inertAttr + ']').length;
    out.snapScrollers = Array.from(document.querySelectorAll('div,section')).filter(e => /mandatory/.test(getComputedStyle(e).scrollSnapType)).slice(0, 2).map(e => desc(e) + ' sh=' + e.scrollHeight + ' ch=' + e.clientHeight + ' k=' + e.children.length);
    out.badges = Array.from(document.querySelectorAll(CONFIG.nav.dmBadge)).slice(0, 3).map(e => desc(e) + ' t=' + short(e.textContent) + ' ' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height));
    const input = document.querySelector(CONFIG.explore.searchInput);
    if (input) {
      const rectOf = e => { const r = e.getBoundingClientRect(); return Math.round(r.top) + '/' + Math.round(r.height); };
      out.searchBox = { active: document.activeElement === input, chain: (() => { const o = []; let e = input; for (let i = 0; i < 7 && e && e !== document.body; i++) { o.push(desc(e) + ' k=' + e.children.length + ' @' + rectOf(e) + ' pos=' + getComputedStyle(e).position + (e.hasAttribute('data-gramini-explore-hide') ? ' XH' : '')); e = e.parentElement; } return o; })() };
      out.viewport = { scrollY: Math.round(scrollY), inner: innerHeight, vvTop: Math.round(visualViewport.offsetTop), vvH: Math.round(visualViewport.height), docH: document.documentElement.scrollHeight };
      out.fixed = Array.from(document.querySelectorAll('div,header,nav,section')).filter(e => /fixed|sticky/.test(getComputedStyle(e).position)).slice(0, 6).map(e => desc(e) + ' @' + rectOf(e));
    }
    post({ type: 'probe', data: JSON.stringify(out) });
  }
  let probeTimer = null;
  function scheduleProbe() {
    if (!DEBUG) return;
    clearTimeout(probeTimer);
    probeTimer = setTimeout(probe, 2500);
  }

  // ---------------------------------------------------------------------------
  // Observer — debounced; no timers otherwise
  // ---------------------------------------------------------------------------
  let pending = null;
  const observer = new MutationObserver(() => {
    if (pending) return;
    pending = setTimeout(() => {
      pending = null;
      applyAll();
      scheduleProbe();
    }, CONFIG.observerDebounceMs);
  });

  function start() {
    applyAll();
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener('popstate', () => { checkRoute(); applyAll(); });
    scheduleProbe();
    log('filter.js active on ' + PLATFORM + (isTop ? '' : ' (frame)') + ' at ' + location.pathname + location.search);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
