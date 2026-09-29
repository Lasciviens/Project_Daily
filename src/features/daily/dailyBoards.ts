// Daily's PageBoard layouts, one declaration per mode and step (THEME.md
// §6.3). Pure data so scripts/verify-page-board.cjs can check every step.
import { resolveBoardLayout, type BoardLayouts, type PageStep } from '../../shared/ui/pageBoardRules'

// ── Day ─────────────────────────────────────────────────────────────────────
//   1  phone, tablet — the schedule hero, then the glance board.
//   2  1280 / 1469 laptop — the same two bands, each the full board wide.
//   3  1920 — the hero spans main + one side, the quick rail beside it, the
//      glance board below at four columns.
//   4  2450 — the glance board moves BESIDE the schedule (three columns), the
//      quick rail sits under the hero as one strip. About half the length.
// The glance board's own column count follows its box (TodaySummary), so its
// cells never move with the content of a day. Where it sits in a column
// beside the hero (not a full-width band) its heading is visually hidden, so
// its cards start level with the hero (glanceInColumn).
export const DAY_SECTIONS = ['hero', 'rail', 'glance'] as const
export type DaySection = typeof DAY_SECTIONS[number]

export const DAY_BOARD: BoardLayouts<DaySection> = {
  1: ['hero', 'glance'],
  2: { top: ['hero'], bottom: ['glance'] },
  3: { columns: [{ stack: ['hero'], span: 2 }, ['rail']], bottom: ['glance'] },
  4: { columns: [['hero', 'rail'], { stack: ['glance'], span: 3 }] },
}

/** True when the glance board sits in a column beside the hero rather than in a band below it. */
export function glanceInColumn(step: PageStep): boolean {
  const l = resolveBoardLayout(DAY_BOARD, step)
  return l.tracks > 1 && l.columns.some(c => c.stack.includes('glance'))
}

// ── Week and Month ──────────────────────────────────────────────────────────
// A picker (week strip / month calendar) plus the picked day, in place:
//   1  week: the picker alone (a tap opens the day); month: calendar and the
//      picked day / upcoming side by side once the page is 56rem wide.
//   2  picker + one pane: the picked day, else Upcoming.
//   3  picker + the picked day's schedule + Upcoming.
//   4  picker + schedule + that day's tasks + Upcoming.
// The picker track stops at 40rem: a month grid stretched to 56rem is all
// empty squares. It stops at four columns (four sections).
export const PICKER_SECTIONS = ['pair', 'picker', 'pickedOrUpcoming', 'picked', 'dayTasks', 'upcoming'] as const
export type PickerSection = typeof PICKER_SECTIONS[number]

const PICKER_MAIN = '40rem'
const PICKER_WIDE = {
  2: { main: PICKER_MAIN, columns: [['picker'], ['pickedOrUpcoming']] },
  3: { main: PICKER_MAIN, columns: [['picker'], ['picked'], ['upcoming']] },
  4: { main: PICKER_MAIN, columns: [['picker'], ['picked'], ['dayTasks'], ['upcoming']] },
} as const

export const WEEK_BOARD: BoardLayouts<PickerSection> = { 1: ['picker'], ...PICKER_WIDE }
export const MONTH_BOARD: BoardLayouts<PickerSection> = { 1: ['pair'], ...PICKER_WIDE }

// ── Tasks ───────────────────────────────────────────────────────────────────
// The task groups become columns, read left to right by time: what needs
// doing now (overdue · open windows · today) | upcoming | no date | done.
// The now-column is 42rem (task rows past that only add empty space).
export const TASK_SECTIONS = ['all', 'now', 'upcoming', 'noDate', 'done', 'later', 'noDateDone'] as const
export type TaskSection = typeof TASK_SECTIONS[number]

const TASKS_MAIN = '42rem'
export const TASKS_BOARD: BoardLayouts<TaskSection> = {
  1: ['all'],
  2: { main: TASKS_MAIN, columns: [['now'], ['later']] },
  3: { main: TASKS_MAIN, columns: [['now'], ['upcoming'], ['noDateDone']] },
  4: { main: TASKS_MAIN, columns: [['now'], ['upcoming'], ['noDate'], ['done']] },
}

/** Which task groups each Tasks section holds — every step shows all six. */
export const TASK_SECTION_GROUPS: Record<TaskSection, readonly TaskGroup[]> = {
  all: ['overdue', 'openNow', 'today', 'upcoming', 'noDate', 'done'],
  now: ['overdue', 'openNow', 'today'],
  upcoming: ['upcoming'],
  noDate: ['noDate'],
  done: ['done'],
  later: ['upcoming', 'noDate', 'done'],
  noDateDone: ['noDate', 'done'],
}
export type TaskGroup = 'overdue' | 'openNow' | 'today' | 'upcoming' | 'noDate' | 'done'
