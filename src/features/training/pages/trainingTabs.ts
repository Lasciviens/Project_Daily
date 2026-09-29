// The Training page's tabs, in order. Next is the default: the page answers
// "what do I do today" first. The id is mirrored in `?tab=` so a link (the
// profile sheet's "Current program" link, a bookmark) can open a tab.
// Log and Library have their own views, switched from the right end of the
// same tab row and kept in `?view=`.
export type TrainingTabId = 'next' | 'program' | 'progress' | 'log' | 'library' | 'coach'

export const TRAINING_TABS: { id: TrainingTabId; label: string }[] = [
  { id: 'next',     label: 'Next' },
  { id: 'program',  label: 'Program' },
  { id: 'progress', label: 'Progress' },
  { id: 'log',      label: 'Log' },
  { id: 'library',  label: 'Library' },
  { id: 'coach',    label: 'Coach' },
]

export const DEFAULT_TRAINING_TAB: TrainingTabId = 'next'

export function parseTrainingTab(raw: string | null): TrainingTabId {
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

/** Where an old Log link now lives, or null when it still lives here. Body
 *  measurements moved to Health → Body (logged in Hevy, shown beside the scale). */
export function movedLogView(tab: TrainingTabId, raw: string | null): string | null {
  return tab === 'log' && raw === 'body' ? '/health?section=body' : null
}
