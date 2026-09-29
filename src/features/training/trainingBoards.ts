// Training's PageBoard layouts, one per tab (THEME.md §6.3). Pure data so
// scripts/verify-life-boards.cjs can check every step.
import type { BoardLayouts } from '../../shared/ui/pageBoardRules'

// ── Next ────────────────────────────────────────────────────────────────────
// What to do: a rail on the left reads the session — which one and when,
// then its context (missed sessions, recovery, the engine's heads-up) — and
// the exercise cards take every other track, gaining columns as the page
// widens. A short routine leaves its space at the far right, not between
// the cards and the context.
export const NEXT_SECTIONS = ['session', 'missed', 'recovery', 'alerts', 'exercises', 'note'] as const
export type NextSection = typeof NEXT_SECTIONS[number]
const NEXT_RAIL = ['session', 'missed', 'recovery', 'alerts'] as const
const NEXT_MAIN = ['exercises', 'note'] as const
export const NEXT_BOARD: BoardLayouts<NextSection> = {
  1: ['session', 'missed', 'recovery', 'alerts', 'exercises', 'note'],
  2: { lead: 1, columns: [NEXT_RAIL, NEXT_MAIN] },
  3: { lead: 1, columns: [NEXT_RAIL, { stack: NEXT_MAIN, span: 2 }] },
  4: { lead: 1, columns: [NEXT_RAIL, { stack: NEXT_MAIN, span: 3 }] },
}

// ── Program ─────────────────────────────────────────────────────────────────
// The plan in columns — which routines and when, then each routine's
// prescription stacked under them in main | what that adds up to per muscle
// | balance. The per-muscle card is by far the tallest, so the routines go
// in a column rather than a band under everything (a band only starts after
// the tallest column ends and left a hole under the shorter ones). Main
// stops at 42rem: the plan's cards are capped there (a week grid or a
// routine list stretched to 56rem is empty space).
export const PROGRAM_SECTIONS = ['current', 'schedule', 'planned', 'balance', 'routines'] as const
export type ProgramSection = typeof PROGRAM_SECTIONS[number]
const PROGRAM_MAIN = '42rem'
export const PROGRAM_BOARD: BoardLayouts<ProgramSection> = {
  1: ['current', 'schedule', 'routines', 'planned', 'balance'],
  2: { main: PROGRAM_MAIN, columns: [['current', 'schedule', 'routines'], ['planned', 'balance']] },
  3: { main: PROGRAM_MAIN, columns: [['current', 'schedule', 'routines'], ['planned'], ['balance']] },
  4: { main: PROGRAM_MAIN, columns: [['current', 'routines'], ['schedule'], ['planned'], ['balance']] },
}

// ── Progress ────────────────────────────────────────────────────────────────
// The per-exercise decisions and the weekly-volume body map in main (across
// two tracks at 1920); the summaries — improvement, the program verdict,
// days since each muscle — in a rail beside them; the supporting charts
// under everything, in columns once opened. At 2450 the table keeps main
// (56rem), the body map takes the two tracks beside it and the rail stays
// last, instead of both spanning two tracks with the summaries ending early.
export const PROGRESS_SECTIONS = ['improvement', 'overview', 'decisions', 'muscles', 'recency', 'charts'] as const
export type ProgressSection = typeof PROGRESS_SECTIONS[number]
const PROGRESS_MAIN = ['decisions', 'muscles'] as const
export const PROGRESS_BOARD: BoardLayouts<ProgressSection> = {
  1: ['improvement', 'overview', 'decisions', 'muscles', 'recency', 'charts'],
  2: { columns: [PROGRESS_MAIN, ['improvement', 'overview', 'recency']], bottom: ['charts'] },
  3: { columns: [{ stack: PROGRESS_MAIN, span: 2 }, ['improvement', 'overview', 'recency']], bottom: ['charts'] },
  4: { columns: [['decisions'], { stack: ['muscles'], span: 2 }, ['improvement', 'overview', 'recency']], bottom: ['charts'] },
}

// ── Log (Hevy view) ─────────────────────────────────────────────────────────
// The month calendar is a sticky rail on the left (as before); the workout
// cards take every other track and gain columns.
export const LOG_SECTIONS = ['calendar', 'workouts'] as const
export type LogSection = typeof LOG_SECTIONS[number]
const CALENDAR = { stack: ['calendar'], sticky: true } as const
export const LOG_BOARD: BoardLayouts<LogSection> = {
  1: ['calendar', 'workouts'],
  2: { lead: 1, columns: [CALENDAR, ['workouts']] },
  3: { lead: 1, columns: [CALENDAR, { stack: ['workouts'], span: 2 }] },
  4: { lead: 1, columns: [CALENDAR, { stack: ['workouts'], span: 3 }] },
}

// ── Coach ───────────────────────────────────────────────────────────────────
// The assessment in main (42rem: the coach card is capped there), the
// training profile it reads beside it, and the history last — it is empty
// until the first assessment, and an empty track belongs at the far right,
// never between two cards.
export const COACH_SECTIONS = ['coach', 'history', 'profile'] as const
export type CoachSection = typeof COACH_SECTIONS[number]
const COACH_MAIN = '42rem'
export const COACH_BOARD: BoardLayouts<CoachSection> = {
  1: ['coach', 'history', 'profile'],
  2: { main: COACH_MAIN, columns: [['coach', 'history'], ['profile']] },
  3: { main: COACH_MAIN, columns: [['coach'], ['profile'], ['history']] },
  // History's rows are short (a date and a chevron): one track, the last one empty.
  4: { main: COACH_MAIN, columns: [['coach'], ['profile'], ['history'], []] },
}
