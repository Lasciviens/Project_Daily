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

// ── Month ───────────────────────────────────────────────────────────────────
// The month calendar (the picker) plus the picked day, in place (the Week tab
// that shared these layouts went on 23.11.2026):
//   1  calendar and the picked day / upcoming side by side once the page is
//      56rem wide (`pair`).
//   2  the calendar takes the page's width, one 24rem pane beside it: the
//      picked day, else Upcoming.
//   3+ the calendar, the picked day (its one list) and Upcoming, 24rem each —
//      at 2450 the calendar grows instead of a fourth track.
// The calendar's track has no cap (owner, 25.11.2026: "i want Bigger
// calendar. Text under dates about the insight. … It should be well
// visible."): every day carries a line per kind, so the width is used, never
// empty squares. Until then it stopped at 40rem and the picked day took two
// tracks at 2450.
export const PICKER_SECTIONS = ['pair', 'picker', 'pickedOrUpcoming', 'picked', 'upcoming'] as const
export type PickerSection = typeof PICKER_SECTIONS[number]

/** No cap: the calendar takes what the side panes leave (as Shop's Owned board does). */
export const PICKER_MAIN = '200rem'
export const MONTH_BOARD: BoardLayouts<PickerSection> = {
  1: ['pair'],
  2: { main: PICKER_MAIN, columns: [['picker'], ['pickedOrUpcoming']] },
  3: { main: PICKER_MAIN, columns: [['picker'], ['picked'], ['upcoming']] },
}

// ── Diary ───────────────────────────────────────────────────────────────────
// The day's own words and what happened that day (owner, 29.10.2026):
//   1  phone, tablet — the words, then the day's list.
//   2+ the day's list in the main track, the words beside it.
export const DIARY_SECTIONS = ['entry', 'timeline'] as const
export type DiarySection = typeof DIARY_SECTIONS[number]

export const DIARY_BOARD: BoardLayouts<DiarySection> = {
  1: ['entry', 'timeline'],
  2: { main: '42rem', columns: [['timeline'], ['entry']] },
}

// ── Tasks ───────────────────────────────────────────────────────────────────
// The task groups become columns, read left to right by time: what needs
// doing now (overdue · open windows · today) | upcoming | no date | done.
// The now-column is 42rem (task rows past that only add empty space).
export const TASK_SECTIONS = ['decide', 'all', 'now', 'upcoming', 'noDate', 'done', 'later', 'noDateDone'] as const
export type TaskSection = typeof TASK_SECTIONS[number]

const TASKS_MAIN = '42rem'
export const TASKS_BOARD: BoardLayouts<TaskSection> = {
  1: ['decide', 'all'],
  2: { main: TASKS_MAIN, columns: [['decide', 'now'], ['later']] },
  3: { main: TASKS_MAIN, columns: [['decide', 'now'], ['upcoming'], ['noDateDone']] },
  4: { main: TASKS_MAIN, columns: [['decide', 'now'], ['upcoming'], ['noDate'], ['done']] },
}

/** Which task groups each Tasks section holds — every step shows all six. */
export const TASK_SECTION_GROUPS: Record<TaskSection, readonly TaskGroup[]> = {
  /** Needs a decision: its own card, no task group of its own (it only adds rows). */
  decide: [],
  all: ['overdue', 'openNow', 'today', 'upcoming', 'noDate', 'done'],
  now: ['overdue', 'openNow', 'today'],
  upcoming: ['upcoming'],
  noDate: ['noDate'],
  done: ['done'],
  later: ['upcoming', 'noDate', 'done'],
  noDateDone: ['noDate', 'done'],
}
export type TaskGroup = 'overdue' | 'openNow' | 'today' | 'upcoming' | 'noDate' | 'done'
