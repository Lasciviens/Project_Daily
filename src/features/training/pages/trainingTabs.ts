// The Training page's tabs, in order. Next is the default: the page answers
// "what do I do today" first. The id is mirrored in `?tab=` so a link (the
// profile sheet's "Current program" link, a bookmark) can open a tab.
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
