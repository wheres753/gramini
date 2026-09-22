import SwiftUI

/// Top-level container: the web view while time remains, the lock screen once
/// the daily limit is reached. Foreground time is tracked from the scene phase.
struct RootView: View {
    @Environment(\.scenePhase) private var scenePhase
    @State private var web = WebViewState()
    @State private var limiter = UsageLimiter()
    @State private var showReadout = false

    var body: some View {
        ZStack {
            Color(uiColor: .systemBackground)
                .ignoresSafeArea()

            if limiter.isLimitReached {
                LimitReachedView(limiter: limiter)
            } else {
                // Kept inside the safe area on purpose: with a full-bleed web view,
                // WKWebView's automatic inset handling scrolls Instagram's fixed
                // headers under the status bar whenever the keyboard opens.
                WebView(state: web)

                if let error = web.loadError {
                    LoadErrorView(message: error) {
                        web.loadError = nil
                        web.controller?.loadHome()
                    }
                }

                if limiter.showWarning {
                    WarningBanner(remaining: limiter.remaining)
                        .frame(maxHeight: .infinity, alignment: .top)
                        .allowsHitTesting(false)
                        .transition(.move(edge: .top).combined(with: .opacity))
                }
            }
        }
        .overlay(alignment: .top) {
            if showReadout {
                UsageReadout(used: limiter.total, remaining: limiter.remaining)
                    .padding(.top, 8)
                    .transition(.opacity)
            }
        }
        .animation(.easeInOut(duration: 0.25), value: limiter.showWarning)
        .animation(.easeInOut(duration: 0.2), value: showReadout)
        .onChange(of: scenePhase, initial: true) { _, phase in
            limiter.setActive(phase == .active)
        }
        // A long press on the page header (top of the web view) shows the
        // time used today; it is hidden otherwise.
        .onChange(of: web.headerPressCount) { _, _ in revealReadout() }
    }

    private func revealReadout() {
        showReadout = true
        Task {
            try? await Task.sleep(for: .seconds(4))
            showReadout = false
        }
    }
}

// MARK: - Pieces

private struct WarningBanner: View {
    let remaining: TimeInterval

    var body: some View {
        Text("\(UsageLimiter.clock(remaining)) left today")
            .font(.footnote.weight(.medium))
            .monospacedDigit()
            .padding(.horizontal, 14)
            .padding(.vertical, 7)
            .background(.regularMaterial, in: Capsule())
            .padding(.top, 8)
    }
}

private struct UsageReadout: View {
    let used: TimeInterval
    let remaining: TimeInterval

    var body: some View {
        Text("Used \(UsageLimiter.clock(used)) · \(UsageLimiter.clock(remaining)) left")
            .font(.footnote)
            .monospacedDigit()
            .padding(.horizontal, 14)
            .padding(.vertical, 7)
            .background(.regularMaterial, in: Capsule())
    }
}

private struct LimitReachedView: View {
    let limiter: UsageLimiter

    var body: some View {
        VStack(spacing: 14) {
            Spacer()
            Image(systemName: "sunset.fill")
                .font(.system(size: 48))
                .foregroundStyle(Color(red: 0.83, green: 0.51, blue: 0.23))
            Text("That's it for today")
                .font(.title2.weight(.semibold))
            Text("Back in \(UsageLimiter.hoursMinutes(limiter.timeUntilMidnight))")
                .font(.body)
                .foregroundStyle(.secondary)
                .monospacedDigit()
            Spacer()
            Text("20 minutes a day. No overrides.")
                .font(.footnote)
                .foregroundStyle(.tertiary)
                .padding(.bottom, 24)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(uiColor: .systemBackground))
    }
}

private struct LoadErrorView: View {
    let message: String
    let retry: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "wifi.exclamationmark")
                .font(.system(size: 40))
                .foregroundStyle(.secondary)
            Text("Couldn't load Instagram")
                .font(.headline)
            Text(message)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
            Button("Try again", action: retry)
                .buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(uiColor: .systemBackground))
    }
}
