// When a new version of the app may replace the one on screen. Pure, no DOM
// (checked by scripts/verify-sw-update.cjs).
//
// A deploy used to reload the page the moment its service worker was ready:
// right after opening the app (the update was found while it opened) and
// sometimes minutes later, in the middle of work (owner, 12.10.2026). Now the
// new version waits until nobody is looking: the app is in the background,
// or it has been left untouched for a while — and never while a popup is
// open or something is typed in a field.

/** Untouched this long (visible on screen) counts as away. */
export const IDLE_MS = 10 * 60 * 1000
/** How often an app left open asks whether a new version exists. */
export const CHECK_EVERY_MS = 30 * 60 * 1000

export interface UpdateMoment {
  /** The page is in the background (another tab, another app, screen off). */
  hidden: boolean
  /** Time since the last tap, click, key or scroll. */
  idleMs: number
  /** A popup, drawer or sheet is open. */
  popupOpen: boolean
  /** The focused field holds text the reload would throw away. */
  typing: boolean
}

export function canApplyUpdate(m: UpdateMoment): boolean {
  if (m.popupOpen || m.typing) return false
  return m.hidden || m.idleMs >= IDLE_MS
}

/** Whether to ask the server for a new version now (not more often than every 15 minutes on return). */
export function shouldCheckForUpdate(sinceLastCheckMs: number, reason: 'interval' | 'visible'): boolean {
  return reason === 'interval' ? sinceLastCheckMs >= CHECK_EVERY_MS - 1000 : sinceLastCheckMs >= 15 * 60 * 1000
}
