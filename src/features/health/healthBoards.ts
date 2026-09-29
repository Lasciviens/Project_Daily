// Health's PageBoard layouts, one per window (THEME.md §6.3). Pure data so
// scripts/verify-life-boards.cjs can check every step. The same pattern in
// every window: its main chart card in the main track, the small trend and
// timing cards beside it, and the mini-metric grids in the tracks after that.
// A window with fewer sections than tracks lets a card span the rest.
import type { BoardLayouts } from '../../shared/ui/pageBoardRules'
import type { HealthSectionId } from './components/sectionTypes'

// ── Overview ────────────────────────────────────────────────────────────────
// The six tiles in main (two across at 1469, three across once they span a
// side track too); what the numbers say beside them. The profile (shown only
// while it is incomplete) sits under the tiles at 1280/1469, where the rail
// is already the taller column, and joins the rail once the tiles span two
// tracks and grow taller.
export const OVERVIEW_SECTIONS = ['hero', 'profile', 'insights'] as const
export const OVERVIEW_BOARD: BoardLayouts<typeof OVERVIEW_SECTIONS[number]> = {
  1: ['hero', 'profile', 'insights'],
  2: { columns: [['hero', 'profile'], ['insights']] },
  3: { columns: [{ stack: ['hero'], span: 2 }, ['insights', 'profile']] },
  4: { columns: [{ stack: ['hero'], span: 2 }, { stack: ['insights', 'profile'], span: 2 }] },
}

// ── Sleep ───────────────────────────────────────────────────────────────────
// Breathing during sleep stays inside the sleep card on a phone and becomes a
// card of its own once there is a track for it (the card checks `keysAt`).
export const SLEEP_SECTIONS = ['sleep', 'timing', 'trend', 'breathing'] as const
export const SLEEP_BOARD: BoardLayouts<typeof SLEEP_SECTIONS[number]> = {
  1: ['sleep', 'timing', 'trend'],
  2: { columns: [['sleep', 'breathing'], ['timing', 'trend']] },
  3: { columns: [['sleep'], ['timing', 'trend'], ['breathing']] },
  // The trend card is always there; timing needs recorded nights and
  // breathing needs data, so they take the later tracks.
  4: { columns: [['sleep'], ['trend'], ['timing'], ['breathing']] },
}

// ── Activity ────────────────────────────────────────────────────────────────
// Steps and energy (the two charts) in main; rings, the steps trend and the
// week's exercise beside them. The three mini-metric groups hide when they
// have no data, so each sits UNDER a card that is always there — a track
// never ends up empty because a watch doesn't record mobility.
export const ACTIVITY_SECTIONS = ['rings', 'steps', 'stepsTrend', 'exercise', 'energy', 'note', 'more', 'mobility', 'habits'] as const
export const ACTIVITY_BOARD: BoardLayouts<typeof ACTIVITY_SECTIONS[number]> = {
  1: ['rings', 'steps', 'stepsTrend', 'exercise', 'energy', 'note', 'more', 'mobility', 'habits'],
  2: { columns: [['steps', 'energy', 'note', 'more', 'mobility', 'habits'], ['rings', 'stepsTrend', 'exercise']] },
  3: { columns: [['steps', 'energy', 'note'], ['rings', 'stepsTrend', 'more'], ['exercise', 'mobility', 'habits']] },
  4: { columns: [['steps', 'energy', 'note'], ['rings', 'more'], ['stepsTrend', 'mobility'], ['exercise', 'habits']] },
}

// ── Heart & vitals ──────────────────────────────────────────────────────────
// The heart charts in main; "what your numbers say" and the two trends beside.
// With one side track the resting-HR trend goes under the heart card, so the
// two columns end at about the same height.
export const HEART_SECTIONS = ['vitals', 'heart', 'rhrTrend', 'hrvTrend'] as const
export const HEART_BOARD: BoardLayouts<typeof HEART_SECTIONS[number]> = {
  1: ['vitals', 'heart', 'rhrTrend', 'hrvTrend'],
  2: { columns: [['heart', 'rhrTrend'], ['vitals', 'hrvTrend']] },
  3: { columns: [['heart'], ['vitals'], ['rhrTrend', 'hrvTrend']] },
  4: { columns: [['heart'], ['vitals'], ['rhrTrend'], ['hrvTrend']] },
}

// ── Body ────────────────────────────────────────────────────────────────────
// The scale charts in main; the weight trend and the Hevy log beside them.
export const BODY_SECTIONS = ['scale', 'trend', 'hevy'] as const
export const BODY_BOARD: BoardLayouts<typeof BODY_SECTIONS[number]> = {
  1: ['scale', 'trend', 'hevy'],
  2: { columns: [['scale'], ['trend', 'hevy']] },
  3: { columns: [['scale'], ['trend'], ['hevy']] },
  4: { columns: [['scale'], ['trend'], { stack: ['hevy'], span: 2 }] },
}

// ── Goal progress ───────────────────────────────────────────────────────────
// The report (verdict, pace, fat vs muscle, weight trend) in main; the goals,
// Muscle watch, protein and calories-vs-scale cards beside it. On a phone the
// goals, protein and calories blocks sit INSIDE the report card (one card —
// the card checks `keysAt`), so step 1 places the report and, as its own card
// right under it (next to the goals block), Muscle watch. Muscle watch always
// renders (it says when data is missing), so it sits under the goals.
// Protein and the (collapsed) calories card are short, so they share a track
// at 2450 and the last track stays empty.
export const GOAL_SECTIONS = ['report', 'goals', 'muscle', 'protein', 'energy'] as const
export const GOAL_BOARD: BoardLayouts<typeof GOAL_SECTIONS[number]> = {
  1: ['report', 'muscle'],
  2: { columns: [['report'], ['goals', 'muscle', 'protein', 'energy']] },
  3: { columns: [['report'], ['goals', 'muscle'], ['protein', 'energy']] },
  4: { columns: [['report'], ['goals', 'muscle'], ['protein', 'energy'], []] },
}

// ── Cardio fitness ──────────────────────────────────────────────────────────
// Two sections: VO₂ max in main, the recovery-and-effort grid beside it
// (inside the VO₂ max card on a phone, like breathing in Sleep). The grid
// holds at most two metrics, so it never spans: from 1920 the window stops
// after two tracks and the rest stays empty on the right.
export const CARDIO_SECTIONS = ['vo2', 'recovery'] as const
export const CARDIO_BOARD: BoardLayouts<typeof CARDIO_SECTIONS[number]> = {
  1: ['vo2'],
  2: { columns: [['vo2'], ['recovery']] },
  3: { columns: [['vo2'], ['recovery'], []] },
  4: { columns: [['vo2'], ['recovery'], [], []] },
}

// ── Workouts ────────────────────────────────────────────────────────────────
// One list; its rows form columns by the card's own width. It spans the whole
// board at 1280/1469 (three row columns) and main + one side track from 1920
// (still three): a week holds a handful of workouts, so a wider card would
// only add empty row columns and push its collapse toggle far from the rows.
export const WORKOUT_SECTIONS = ['list'] as const
// (A band only spans the tracks its step declares, so every step names it.)
export const WORKOUT_BOARD: BoardLayouts<typeof WORKOUT_SECTIONS[number]> = {
  1: ['list'],
  2: { top: ['list'] },
  3: { columns: [{ stack: ['list'], span: 2 }, []] },
  4: { columns: [{ stack: ['list'], span: 2 }, [], []] },
}

/** Every window's board, for the verify script. */
export const HEALTH_BOARDS: Record<HealthSectionId, { board: BoardLayouts<string>; sections: readonly string[] }> = {
  overview: { board: OVERVIEW_BOARD, sections: OVERVIEW_SECTIONS },
  sleep:    { board: SLEEP_BOARD, sections: SLEEP_SECTIONS },
  activity: { board: ACTIVITY_BOARD, sections: ACTIVITY_SECTIONS },
  heart:    { board: HEART_BOARD, sections: HEART_SECTIONS },
  body:     { board: BODY_BOARD, sections: BODY_SECTIONS },
  goal:     { board: GOAL_BOARD, sections: GOAL_SECTIONS },
  cardio:   { board: CARDIO_BOARD, sections: CARDIO_SECTIONS },
  workouts: { board: WORKOUT_BOARD, sections: WORKOUT_SECTIONS },
}
