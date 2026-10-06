//! Dirty-document close/quit coordination between the native shell and the
//! WebView renderer (wps_10 A1). Native close/quit never destroys a window
//! outright: it asks the renderer — which alone knows which tabs hold unsaved
//! edits — and only proceeds once every window resolves its save prompts.
//!
//! A single [`WindowGuard`] lives in [`crate::state::AppState`].

use std::collections::HashSet;

#[derive(Default)]
pub(crate) struct WindowGuard {
    /// Window labels explicitly allowed to close after the renderer resolved
    /// every dirty tab in that window.
    close_confirmed: HashSet<String>,
    quit: QuitGuard,
}

#[derive(Default)]
struct QuitGuard {
    /// A quit flow is in progress and windows must ack before exit.
    armed: bool,
    /// Windows yet to confirm (or be destroyed). Starts at the window count
    /// captured when the flow was armed.
    pending: usize,
    /// Total windows captured at arm time; lets the unresponsive-renderer
    /// fallback distinguish "no renderer answered at all" from "a human is
    /// slowly working through prompts".
    total: usize,
}

impl WindowGuard {
    /// Remove and return whether this window may close right now because its
    /// renderer already resolved its dirty tabs. The token is one-shot: the
    /// native `CloseRequested` handler consumes it so later unconfirmed closes
    /// are guarded again.
    pub(crate) fn take_close_allowed(&mut self, label: &str) -> bool {
        self.close_confirmed.remove(label)
    }

    /// Mark this window as cleared to close (renderer finished its save flow).
    pub(crate) fn mark_close_confirmed(&mut self, label: &str) {
        self.close_confirmed.insert(label.to_owned());
    }

    /// Begin a quit flow. Returns false if one is already armed (a duplicate
    /// menu/shortcut invocation — ignore).
    pub(crate) fn arm_quit(&mut self, windows: usize) -> bool {
        if self.quit.armed {
            return false;
        }
        self.quit.armed = true;
        self.quit.pending = windows;
        self.quit.total = windows;
        true
    }

    /// One window's renderer finished (saved or discarded every dirty tab).
    /// Returns true when the last window confirmed and the app must exit.
    pub(crate) fn confirm_quit(&mut self) -> bool {
        if !self.quit.armed {
            return false;
        }
        self.quit.pending = self.quit.pending.saturating_sub(1);
        if self.quit.pending == 0 {
            self.quit.armed = false;
            true
        } else {
            false
        }
    }

    /// Abort the whole flow (a user pressed Cancel in any window).
    pub(crate) fn cancel_quit(&mut self) {
        self.quit.armed = false;
        self.quit.pending = 0;
        self.quit.total = 0;
    }

    /// A window was destroyed while a quit flow was active: its ack will never
    /// arrive, so release the slot. Returns true when it was the last pending
    /// window and the app must exit.
    pub(crate) fn note_window_destroyed(&mut self) -> bool {
        if !self.quit.armed {
            return false;
        }
        self.confirm_quit()
    }

    /// Whether no window answered the quit request at all yet. The
    /// unresponsive-renderer fallback uses this to force-exit only when every
    /// WebView is dead; as soon as one human interacts (an ack, a closed
    /// window) this returns false so a slow reader is never killed mid-decision.
    pub(crate) fn quit_completely_unanswered(&self) -> bool {
        self.quit.armed && self.quit.pending == self.quit.total
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn close_token_is_one_shot() {
        let mut guard = WindowGuard::default();
        assert!(!guard.take_close_allowed("main"));
        guard.mark_close_confirmed("main");
        assert!(guard.take_close_allowed("main"));
        assert!(!guard.take_close_allowed("main"));
    }

    #[test]
    fn quit_flow_waits_for_every_window() {
        let mut guard = WindowGuard::default();
        assert!(guard.arm_quit(2));
        assert!(!guard.arm_quit(2), "duplicate arm is ignored");
        assert!(!guard.confirm_quit());
        assert!(guard.confirm_quit(), "last confirmation triggers exit");
    }

    #[test]
    fn destroyed_window_releases_its_slot() {
        let mut guard = WindowGuard::default();
        guard.arm_quit(2);
        assert!(!guard.confirm_quit());
        assert!(guard.note_window_destroyed());
    }

    #[test]
    fn cancel_disarms_and_is_counted_as_interaction() {
        let mut guard = WindowGuard::default();
        guard.arm_quit(2);
        guard.cancel_quit();
        assert!(!guard.confirm_quit(), "no exit after cancel");
        assert!(!guard.note_window_destroyed());
    }

    #[test]
    fn unanswered_tracks_any_interaction() {
        let mut guard = WindowGuard::default();
        guard.arm_quit(2);
        assert!(guard.quit_completely_unanswered());
        assert!(!guard.confirm_quit());
        assert!(!guard.quit_completely_unanswered());
    }
}
