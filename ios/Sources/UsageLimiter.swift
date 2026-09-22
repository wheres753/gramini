import Foundation
import Observation

/// Tracks foreground time per local day and enforces the daily limit. Time
/// counts only while the scene is active. Persisted in UserDefaults, keyed by
/// local date, so it survives relaunches and resets at local midnight.
@MainActor
@Observable
final class UsageLimiter {
    static let dailyLimit: TimeInterval = 20 * 60
    static let warningLead: TimeInterval = 2 * 60

    private(set) var usedToday: TimeInterval = 0
    private(set) var isActive = false
    /// Ticks once a second while active so views refresh; also drives the
    /// midnight rollover check.
    private(set) var now = Date()

    private var activeSince: Date?
    private var dateKey: String
    private var ticker: Task<Void, Never>?
    private let defaults = UserDefaults.standard
    private let limit: TimeInterval

    private enum Key {
        static let date = "usage.date"
        static let seconds = "usage.seconds"
    }

    init() {
        var limit = Self.dailyLimit
        #if DEBUG
        // `-GraminiLimitSeconds 90` shortens the limit for testing;
        // `-GraminiResetUsage YES` clears today's tally.
        let override = UserDefaults.standard.double(forKey: "GraminiLimitSeconds")
        if override > 0 { limit = override }
        if UserDefaults.standard.bool(forKey: "GraminiResetUsage") {
            UserDefaults.standard.removeObject(forKey: Key.seconds)
            UserDefaults.standard.removeObject(forKey: Key.date)
        }
        #endif
        self.limit = limit
        dateKey = Self.key(for: Date())
        if defaults.string(forKey: Key.date) == dateKey {
            usedToday = defaults.double(forKey: Key.seconds)
        }
    }

    // MARK: - Derived state

    var total: TimeInterval { usedToday + currentSession }
    var remaining: TimeInterval { max(0, limit - total) }
    var isLimitReached: Bool { total >= limit }
    var showWarning: Bool { !isLimitReached && remaining <= Self.warningLead }

    var timeUntilMidnight: TimeInterval {
        let cal = Calendar.current
        let midnight = cal.startOfDay(for: cal.date(byAdding: .day, value: 1, to: now) ?? now)
        return max(0, midnight.timeIntervalSince(now))
    }

    private var currentSession: TimeInterval {
        guard let start = activeSince else { return 0 }
        return now.timeIntervalSince(start)
    }

    // MARK: - Scene phase

    func setActive(_ active: Bool) {
        guard active != isActive else { return }
        isActive = active
        now = Date()
        rolloverIfNeeded()
        if active {
            activeSince = now
            startTicking()
        } else {
            commitSession()
            ticker?.cancel()
            ticker = nil
        }
        persist()
    }

    // MARK: - Internals

    private func startTicking() {
        ticker?.cancel()
        ticker = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(1))
                guard let self, !Task.isCancelled else { return }
                self.tick()
            }
        }
    }

    private func tick() {
        now = Date()
        if rolloverIfNeeded() { return }
        // Persist every 5 s so a hard kill loses at most that much.
        if Int(now.timeIntervalSinceReferenceDate) % 5 == 0 { persist() }
    }

    /// Folds the running session into `usedToday`.
    private func commitSession() {
        guard let start = activeSince else { return }
        usedToday += now.timeIntervalSince(start)
        activeSince = nil
    }

    /// Resets the tally when the local date changes. Returns true if it did.
    @discardableResult
    private func rolloverIfNeeded() -> Bool {
        let today = Self.key(for: now)
        guard today != dateKey else { return false }
        dateKey = today
        usedToday = 0
        if isActive { activeSince = now }
        persist()
        return true
    }

    private func persist() {
        defaults.set(dateKey, forKey: Key.date)
        defaults.set(total, forKey: Key.seconds)
    }

    private static func key(for date: Date) -> String {
        let c = Calendar.current.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    // MARK: - Formatting

    static func clock(_ t: TimeInterval) -> String {
        let s = Int(t.rounded(.down))
        return String(format: "%d:%02d", s / 60, s % 60)
    }

    static func hoursMinutes(_ t: TimeInterval) -> String {
        let m = Int((t / 60).rounded(.up))
        let h = m / 60, r = m % 60
        if h == 0 { return "\(r) min" }
        return r == 0 ? "\(h) h" : "\(h) h \(r) min"
    }
}
