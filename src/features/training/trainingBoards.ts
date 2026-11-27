// Training's PageBoard layouts, one per tab (THEME.md §6.3). Pure data so
// scripts/verify-life-boards.cjs can check every step.
import type { BoardLayouts } from '../../shared/ui/pageBoardRules'

// ── Today (was Next) ────────────────────────────────────────────────────────
// What to do: a rail on the left reads the session — which one and when,
// then its context (this week's sessions, recovery, the engine's heads-up) — and
// the exercise cards take every other track, gaining columns as the page
// widens. A short routine leaves its space at the far right, not between
// the cards and the context.
export const NEXT_SECTIONS = ['session', 'week', 'recovery', 'alerts', 'exercises', 'note'] as const
export type NextSection = typeof NEXT_SECTIONS[number]
const NEXT_RAIL = ['session', 'week', 'recovery', 'alerts'] as const
const NEXT_MAIN = ['exercises', 'note'] as const
export const NEXT_BOARD: BoardLayouts<NextSection> = {
  1: ['session', 'week', 'recovery', 'alerts', 'exercises', 'note'],
  2: { lead: 1, columns: [NEXT_RAIL, NEXT_MAIN] },
  3: { lead: 1, columns: [NEXT_RAIL, { stack: NEXT_MAIN, span: 2 }] },
  4: { lead: 1, columns: [NEXT_RAIL, { stack: NEXT_MAIN, span: 3 }] },
}

// ── Plan (was Program) ──────────────────────────────────────────────────────
// The plan in columns — which routines and when, then each routine's
// prescription stacked under them in main | what that adds up to per muscle
// | balance. The per-muscle card is by far the tallest, so the routines go
// in a column rather than a band under everything (a band only starts after
// the tallest column ends and left a hole under the shorter ones). Main
// stops at 42rem: the plan's cards are capped there (a week grid or a
// routine list stretched to 56rem is empty space). So the board takes its
// next track as soon as it fits (`early`: three tracks from 92rem, four from
// 117rem) — on the page's own steps (100 / 128rem) the 67rem board left the
// right side empty, 26.7rem of it on a 1795px screen (owner, 03.11.2026).
export const PROGRAM_SECTIONS = ['current', 'schedule', 'planned', 'balance', 'routines'] as const
export type ProgramSection = typeof PROGRAM_SECTIONS[number]
const PROGRAM_MAIN = '42rem'
export const PROGRAM_BOARD: BoardLayouts<ProgramSection> = {
  1: ['current', 'schedule', 'routines', 'planned', 'balance'],
  2: { main: PROGRAM_MAIN, columns: [['current', 'schedule', 'routines'], ['planned', 'balance']] },
  3: { early: true, main: PROGRAM_MAIN, columns: [['current', 'schedule', 'routines'], ['planned'], ['balance']] },
  4: { early: true, main: PROGRAM_MAIN, columns: [['current', 'routines'], ['schedule'], ['planned'], ['balance']] },
}

// ── Results ─────────────────────────────────────────────────────────────────
// Three plain cards and the exercise list (owner, 27.11.2026: "Yes" to Results = three simple cards with the
// details behind a tap). A laptop reads Main lifts over the list in main and Consistency over Weekly sets in the
// rail; a 1920 screen gives each card its own track beside the list's column; a 2450 one puts the list first and
// the three cards beside it. The muscle watch (only during a cut) is a band on top; the details band is last.
export const RESULTS_SECTIONS = ['watch', 'lifts', 'sets', 'consistency', 'exercises', 'more'] as const
export type ResultsSection = typeof RESULTS_SECTIONS[number]
// Main stops at 44rem: a lift or exercise row stretched to 56rem puts its pill far from its name; the board takes
// its next track as soon as it fits (`early`).
const RESULTS_MAIN = '44rem'
export const RESULTS_BOARD: BoardLayouts<ResultsSection> = {
  1: ['watch', 'lifts', 'sets', 'consistency', 'exercises', 'more'],
  2: { main: RESULTS_MAIN, top: ['watch'], columns: [['lifts', 'exercises'], ['consistency', 'sets']], bottom: ['more'] },
  3: { early: true, main: RESULTS_MAIN, top: ['watch'], columns: [['lifts', 'exercises'], ['consistency'], ['sets']], bottom: ['more'] },
  4: { early: true, main: RESULTS_MAIN, top: ['watch'], columns: [['exercises'], ['lifts'], ['consistency'], ['sets']], bottom: ['more'] },
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
