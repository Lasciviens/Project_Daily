// The Training page's tabs, in order. Today is the default: the page answers
// "what do I do today" first. The id is mirrored in `?tab=` so a link (the
// profile sheet's "Current program" link, a bookmark) can open a tab.
// Renamed on 27.11.2026 (owner: "Yes" to Next → Today, Program → Plan,
// Progress → Results); the old ids still land through `legacyTrainingTab`.
// Log and Library have their own views, switched right after the tabs in the
// same row and kept in `?view=`.
export type TrainingTabId = 'today' | 'plan' | 'results' | 'log' | 'library' | 'coach'

export const TRAINING_TABS: { id: TrainingTabId; label: string }[] = [
  { id: 'today',    label: 'Today' },
  { id: 'plan',     label: 'Plan' },
  { id: 'results',  label: 'Results' },
  { id: 'log',      label: 'Log' },
  { id: 'library',  label: 'Library' },
  { id: 'coach',    label: 'Coach' },
]

export const DEFAULT_TRAINING_TAB: TrainingTabId = 'today'

/** The tabs' names before 27.11.2026 — a bookmark or an old link still opens the tab under its new name. */
const LEGACY_TABS: Readonly<Record<string, TrainingTabId>> = { next: 'today', program: 'plan', progress: 'results' }

/** The new id for an old `?tab=` value (the page replaces the URL with it), or null when `raw` is not an old one. */
export function legacyTrainingTab(raw: string | null): TrainingTabId | null {
  return raw != null && Object.prototype.hasOwnProperty.call(LEGACY_TABS, raw) ? LEGACY_TABS[raw] : null
}

export function parseTrainingTab(raw: string | null): TrainingTabId {
  const legacy = legacyTrainingTab(raw)
  if (legacy) return legacy
  return TRAINING_TABS.some(t => t.id === raw) ? raw as TrainingTabId : DEFAULT_TRAINING_TAB
}

// ─── Sub-views ───────────────────────────────────────────────────────────────

/** Log: what Hevy recorded (workouts + the calendar) or what Strava did. */
export type LogView = 'hevy' | 'strava'
export const LOG_VIEWS: { value: LogView; label: string }[] = [
  { value: 'hevy',   label: 'Hevy' },
  { value: 'strava', label: 'Strava' },
]

export type LibraryView = 'routines' | 'exercises'
export const LIBRARY_VIEWS: { value: LibraryView; label: string }[] = [
  { value: 'routines',  label: 'Routines' },
  { value: 'exercises', label: 'Exercises' },
]

/** `?view=` for Log. The old names still land: `workouts` → Hevy. (The old
 *  `body` view moved to Health → Body — see `movedLogView`.) */
export function parseLogView(raw: string | null): LogView {
  return raw === 'strava' ? 'strava' : 'hevy'
}

export function parseLibraryView(raw: string | null): LibraryView {
  return raw === 'exercises' ? 'exercises' : 'routines'
}

/** Which tab's own views the tab row's views slot shows (null: the slot stays empty but keeps its room). */
export function viewSlotOf(tab: TrainingTabId): 'log' | 'library' | null {
  return tab === 'log' || tab === 'library' ? tab : null
}

/** Where an old Log link now lives, or null when it still lives here. Body
 *  measurements moved to Health → Body (logged in Hevy, shown beside the scale). */
export function movedLogView(tab: TrainingTabId, raw: string | null): string | null {
  return tab === 'log' && raw === 'body' ? '/health?section=body' : null
}
