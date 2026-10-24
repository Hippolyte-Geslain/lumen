// Live mode boot: connect every source; each one reports into state.live.

import { LIVE } from './runtime.js';
import { syncCalendars, refreshEvents, syncGmail, syncDrive, buildNotices } from './sources.js';
import { startWorkspace } from './workspace.js';
import { state, commit, subscribe } from '../store.js';

export { LIVE };

export function startLive() {
  if (!LIVE) return;
  startWorkspace();
  syncCalendars();
  syncGmail();
  syncDrive();

  // Calendar reads are paged calls rather than one watch: refresh on a timer
  // and whenever the tab comes back.
  setInterval(() => !document.hidden && refreshEvents(), 5 * 60_000);
  document.addEventListener('visibilitychange', () => !document.hidden && refreshEvents());
  // "Starts in 15 min" notices age every minute.
  setInterval(() => {
    buildNotices();
    commit('notices');
  }, 60_000);
  // Calendar choice / declined filter live in settings.
  let lastCal = JSON.stringify([state.settings.calendars, state.settings.hideDeclined]);
  subscribe('settings', () => {
    const now = JSON.stringify([state.settings.calendars, state.settings.hideDeclined]);
    if (now !== lastCal) {
      lastCal = now;
      refreshEvents();
    }
  });
}
