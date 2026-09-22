import Foundation

/// Shortcodes of posts that have been seen (≥60% visible for 1.5 s, decided by
/// filter.js). Kept as a JSON array in Application Support, most recent last,
/// capped at `capacity`. Injected into every page load so the feed can stop at
/// the first already-seen post.
@MainActor
final class SeenStore {
    static let capacity = 2000

    private(set) var codes: [String] = []
    private var index: Set<String> = []
    private var saveTask: Task<Void, Never>?

    private let fileURL: URL = {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let dir = base.appendingPathComponent("Gramini", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("seen.json")
    }()

    init() {
        load()
    }

    func contains(_ code: String) -> Bool { index.contains(code) }

    /// Records `code` as the most recently seen post.
    func add(_ code: String) {
        guard isValid(code) else { return }
        if index.contains(code) {
            codes.removeAll { $0 == code }
        }
        codes.append(code)
        index.insert(code)
        if codes.count > Self.capacity {
            let dropped = codes.prefix(codes.count - Self.capacity)
            dropped.forEach { index.remove($0) }
            codes.removeFirst(codes.count - Self.capacity)
        }
        scheduleSave()
    }

    func removeAll() {
        codes = []
        index = []
        scheduleSave()
    }

    /// JavaScript that publishes the seen set before filter.js runs.
    func userScriptSource() -> String {
        let data = (try? JSONEncoder().encode(codes)) ?? Data("[]".utf8)
        let json = String(data: data, encoding: .utf8) ?? "[]"
        return "window.__graminiSeen = \(json);"
    }

    // MARK: - Persistence

    private func isValid(_ code: String) -> Bool {
        !code.isEmpty && code.count <= 64 &&
        code.allSatisfy { $0.isLetter || $0.isNumber || $0 == "_" || $0 == "-" }
    }

    private func load() {
        guard let data = try? Data(contentsOf: fileURL),
              let list = try? JSONDecoder().decode([String].self, from: data) else { return }
        codes = Array(list.filter(isValid).suffix(Self.capacity))
        index = Set(codes)
    }

    private func scheduleSave() {
        saveTask?.cancel()
        let snapshot = codes
        let url = fileURL
        saveTask = Task {
            try? await Task.sleep(for: .seconds(1))
            guard !Task.isCancelled else { return }
            if let data = try? JSONEncoder().encode(snapshot) {
                try? data.write(to: url, options: .atomic)
            }
        }
    }
}
