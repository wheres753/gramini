import SwiftUI
import UIKit.UIGestureRecognizerSubclass
import WebKit

/// Observable state shared between the SwiftUI shell and the web view.
@MainActor
@Observable
final class WebViewState {
    var loadError: String?
    /// Incremented on each long press on the page header.
    var headerPressCount = 0
    /// Set by `WebView` once the underlying `WKWebView` exists.
    weak var controller: WebViewController?
}

/// Hosts the Instagram web view. Display-only: it injects the bundled
/// `filter.css` / `filter.js`, keeps navigation inside Instagram's own domains,
/// and never touches page content itself.
struct WebView: UIViewRepresentable {
    let state: WebViewState

    static let homeURL = URL(string: "https://www.instagram.com/?variant=following")!

    /// Mobile Safari UA. Instagram serves the full mobile site (posting,
    /// activity, DMs) only when it sees `Version/… Mobile/… Safari/…`.
    static let userAgent =
        "Mozilla/5.0 (iPhone; CPU iPhone OS 26_6 like Mac OS X) "
        + "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1"

    func makeCoordinator() -> WebViewController {
        WebViewController(state: state)
    }

    func makeUIView(context: Context) -> WKWebView {
        let controller = context.coordinator

        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()          // persistent cookies -> login survives restarts
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.defaultWebpagePreferences.allowsContentJavaScript = true
        config.userContentController = controller.makeUserContentController()

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.customUserAgent = Self.userAgent
        webView.navigationDelegate = controller
        webView.uiDelegate = controller
        webView.allowsBackForwardNavigationGestures = true   // edge swipe = back; no nav chrome
        webView.allowsLinkPreview = false
        #if DEBUG
        webView.isInspectable = true   // Safari ▸ Develop ▸ <iPhone> ▸ Gramini
        #endif
        webView.isOpaque = true
        webView.backgroundColor = .systemBackground
        webView.underPageBackgroundColor = .systemBackground
        webView.scrollView.contentInsetAdjustmentBehavior = .never   // the SwiftUI layout handles safe areas
        webView.scrollView.bounces = true

        // Long press on the page header (Instagram's top bar) -> usage readout.
        // Runs alongside the page's own touch handling; never cancels it.
        let press = HeaderPressRecognizer(target: controller, action: #selector(WebViewController.handleHeaderPress(_:)))
        press.minimumPressDuration = 0.6
        press.cancelsTouchesInView = false
        press.delegate = controller
        webView.addGestureRecognizer(press)

        let refresh = UIRefreshControl()
        refresh.addTarget(controller, action: #selector(WebViewController.handleRefresh), for: .valueChanged)
        webView.scrollView.refreshControl = refresh

        controller.webView = webView
        state.controller = controller
        controller.loadHome()
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}
}

// MARK: - Controller / delegates

@MainActor
final class WebViewController: NSObject {
    private let state: WebViewState
    let seen = SeenStore()
    weak var webView: WKWebView?
    private weak var userContentController: WKUserContentController?

    /// Hosts that are allowed to load inside the app. Anything else opens in
    /// Safari. Suffix match, so `instagram.com` also covers `www.instagram.com`.
    /// The Meta/Facebook entries exist for the login + checkpoint flow; trim or
    /// extend after testing (see NOTES.md).
    static let allowedHostSuffixes: [String] = [
        "instagram.com",
        "cdninstagram.com",
        "fbcdn.net",
        "facebook.com",
        "fb.com",
        "meta.com",
    ]

    init(state: WebViewState) {
        self.state = state
    }

    func loadHome() {
        webView?.load(URLRequest(url: WebView.homeURL))
    }

    /// Height of the page region that counts as the header, in points.
    static let headerHeight: CGFloat = 60

    @objc func handleHeaderPress(_ gr: UILongPressGestureRecognizer) {
        if gr.state == .began {
            state.headerPressCount += 1
            #if DEBUG
            print("[gramini] header long press")
            #endif
        }
    }

    @objc func handleRefresh() {
        guard let webView else { return }
        // Pull-to-refresh always returns to the Following feed. Reloading a
        // deep page (a post, a profile) is rarely what a pull means here.
        if webView.url?.path == "/" || webView.url == nil {
            webView.load(URLRequest(url: WebView.homeURL))
        } else {
            webView.reload()
        }
    }

    func makeUserContentController() -> WKUserContentController {
        let ucc = WKUserContentController()
        userContentController = ucc
        installUserScripts(in: ucc)
        ucc.add(self, name: "gramini")
        return ucc
    }

    /// User scripts are fixed per page load, so the seen list is re-published
    /// before every main-frame navigation (see `decidePolicyFor`).
    func refreshUserScripts() {
        guard let ucc = userContentController else { return }
        ucc.removeAllUserScripts()
        installUserScripts(in: ucc)
    }

    private func installUserScripts(in ucc: WKUserContentController) {
        #if DEBUG
        // Lets filter.js post its structural probe (see `probe()` there).
        ucc.addUserScript(WKUserScript(source: "window.__graminiDebug = true;",
                                       injectionTime: .atDocumentStart, forMainFrameOnly: false))
        #endif

        // Seen shortcodes, so the feed can stop at the first already-seen post.
        ucc.addUserScript(WKUserScript(source: seen.userScriptSource(),
                                       injectionTime: .atDocumentStart, forMainFrameOnly: true))

        if let css = bundledText("filter", ext: "css") {
            // Inject the stylesheet at document start so attention traps never flash.
            let js = """
            (function () {
              var s = document.createElement('style');
              s.id = 'gramini-css';
              s.textContent = \(jsStringLiteral(css));
              (document.head || document.documentElement).appendChild(s);
            })();
            """
            ucc.addUserScript(WKUserScript(source: js, injectionTime: .atDocumentStart, forMainFrameOnly: false))
        }

        if let js = bundledText("filter", ext: "js") {
            ucc.addUserScript(WKUserScript(source: js, injectionTime: .atDocumentEnd, forMainFrameOnly: false))
        }
    }

    private func bundledText(_ name: String, ext: String) -> String? {
        guard let url = Bundle.main.url(forResource: name, withExtension: ext) else {
            assertionFailure("Missing bundled resource \(name).\(ext)")
            return nil
        }
        return try? String(contentsOf: url, encoding: .utf8)
    }

    private func jsStringLiteral(_ s: String) -> String {
        let data = try? JSONEncoder().encode(s)
        return data.flatMap { String(data: $0, encoding: .utf8) } ?? "\"\""
    }

    // MARK: Domain policy

    /// Attention-trap routes that never load, even if filter.js is broken:
    /// the Reels tab and its audio pages. A single reel (`/reels/<code>/`) is
    /// fine — filter.js pins the viewer to that one reel.
    static func isBlockedRoute(_ url: URL) -> Bool {
        guard let host = url.host?.lowercased(), host == "instagram.com" || host.hasSuffix(".instagram.com") else { return false }
        let path = url.path.hasSuffix("/") ? url.path : url.path + "/"
        return path == "/reels/" || path.hasPrefix("/reels/audio/")
    }

    static func isAllowed(_ url: URL) -> Bool {
        guard let scheme = url.scheme?.lowercased(), scheme == "https" || scheme == "http",
              let host = url.host?.lowercased() else { return false }
        return allowedHostSuffixes.contains { host == $0 || host.hasSuffix("." + $0) }
    }

    /// Instagram wraps outbound links as `https://l.instagram.com/?u=<encoded>`.
    /// Unwrap so Safari gets the real destination straight away.
    static func unwrappedExternalURL(_ url: URL) -> URL {
        guard url.host?.lowercased() == "l.instagram.com",
              let comps = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let target = comps.queryItems?.first(where: { $0.name == "u" })?.value,
              let real = URL(string: target) else { return url }
        return real
    }

    private func openExternally(_ url: URL) {
        let target = Self.unwrappedExternalURL(url)
        UIApplication.shared.open(target)
    }
}

/// Long press limited to the page header. Fails at touch-down anywhere else so
/// it never delays scrolling or taps in the page body.
final class HeaderPressRecognizer: UILongPressGestureRecognizer {
    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
        super.touchesBegan(touches, with: event)
        if let view, let touch = touches.first,
           touch.location(in: view).y > WebViewController.headerHeight {
            state = .failed
        }
    }
}

extension WebViewController: UIGestureRecognizerDelegate {
    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer,
                           shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
        true
    }

    /// WebKit's own long press (text selection, callout) waits for ours inside
    /// the header, so a header press shows the readout instead of selecting text.
    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer,
                           shouldBeRequiredToFailBy other: UIGestureRecognizer) -> Bool {
        other is UILongPressGestureRecognizer
    }
}

extension WebViewController: WKNavigationDelegate {
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction) async -> WKNavigationActionPolicy {
        guard let url = navigationAction.request.url else { return .cancel }

        // Sub-frames (login iframes, embeds) are left to the page.
        if !(navigationAction.targetFrame?.isMainFrame ?? true) { return .allow }

        if url.host?.lowercased() == "l.instagram.com" {
            openExternally(url)
            return .cancel
        }

        if Self.isBlockedRoute(url) {
            loadHome()
            return .cancel
        }

        if Self.isAllowed(url) {
            refreshUserScripts()
            return .allow
        }

        // Anything else — other sites, mailto:, itms-apps:, custom schemes — leaves the app.
        openExternally(url)
        return .cancel
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        state.loadError = nil
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        webView.scrollView.refreshControl?.endRefreshing()
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        handle(error, in: webView)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        handle(error, in: webView)
    }

    private func handle(_ error: Error, in webView: WKWebView) {
        webView.scrollView.refreshControl?.endRefreshing()
        let nsError = error as NSError
        // Cancelled loads (our own .cancel, or a quick second tap) aren't failures.
        if nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled { return }
        if nsError.domain == "WebKitErrorDomain" && nsError.code == 102 { return } // frame load interrupted
        // Only show the error screen when there is nothing usable on screen.
        if webView.url == nil || webView.backForwardList.currentItem == nil {
            state.loadError = nsError.localizedDescription
        }
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload()
    }
}

extension WebViewController: WKUIDelegate {
    /// `target="_blank"` links: keep Instagram pages in this web view, send
    /// everything else to Safari. Never create a second web view.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        guard let url = navigationAction.request.url else { return nil }
        if Self.isAllowed(url), url.host?.lowercased() != "l.instagram.com" {
            webView.load(navigationAction.request)
        } else {
            openExternally(url)
        }
        return nil
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo) async {
        _ = await presentAlert(title: nil, message: message, buttons: [("OK", true)])
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo) async -> Bool {
        await presentAlert(title: nil, message: message, buttons: [("Cancel", false), ("OK", true)])
    }

    private func presentAlert(title: String?, message: String, buttons: [(String, Bool)]) async -> Bool {
        guard let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
              var top = scene.keyWindow?.rootViewController else { return false }
        while let presented = top.presentedViewController { top = presented }
        return await withCheckedContinuation { cont in
            let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
            for (label, value) in buttons {
                alert.addAction(UIAlertAction(title: label, style: value ? .default : .cancel) { _ in
                    cont.resume(returning: value)
                })
            }
            top.present(alert, animated: true)
        }
    }
}

extension WebViewController: WKScriptMessageHandler {
    /// Bridge from `filter.js` (`window.webkit.messageHandlers.gramini.postMessage`).
    /// `log`/`probe` are DEBUG diagnostics; `seen` records a post shortcode.
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        switch type {
        case "log":
            #if DEBUG
            print("[filter.js] \(body["message"] ?? "")")
            #endif
        case "probe":
            #if DEBUG
            print("[probe] \(body["data"] ?? "")")
            #endif
        case "seen":
            if let code = body["code"] as? String { seen.add(code) }
        default:
            break
        }
    }
}
