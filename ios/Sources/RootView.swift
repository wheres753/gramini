import SwiftUI

/// Top-level container. Phase 1 shows the web view only; later phases swap in
/// the daily-limit screen here.
struct RootView: View {
    @State private var web = WebViewState()

    var body: some View {
        ZStack {
            Color(uiColor: .systemBackground)
                .ignoresSafeArea()

            WebView(state: web)
                .ignoresSafeArea()

            if let error = web.loadError {
                LoadErrorView(message: error) {
                    web.loadError = nil
                    web.controller?.loadHome()
                }
            }
        }
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
