// Food's PageBoard layouts (THEME.md §6.3). Pure data so
// scripts/verify-life-boards.cjs can check every step.
import type { BoardLayouts } from '../../shared/ui/pageBoardRules'

// ── Today ───────────────────────────────────────────────────────────────────
// The day's totals and the quick-log cards lead on the left (a rail), the
// meal slots take the main track with the last days under them (they need the
// width: a column per day, the findings beside the chart), and the coach
// fills the tracks to the right:
//   1  phone, tablet — the day's nutrition on top, then the meal slots (owner,
//      07.10.2026), then water, what fits, quick guess, last days, coach.
//   2  1280 / 1469 / 1795 — the rail (nutrition, water, what fits, quick
//      guess) beside the slots; the last days and the coach under the slots
//      (owner, 13.10.2026: the stats sat in the narrow rail while main was empty).
//   3  1920 — nutrition + water + what fits + quick guess | slots + last days | coach.
//   4  2450 — nutrition + water | slots + last days | what fits + quick guess | coach.
// "What fits" can be empty, so it always shares its track with the quick
// guess (never empty): no track is ever left blank.
export const FOOD_TODAY_SECTIONS = ['nutrition', 'water', 'fits', 'guess', 'history', 'coach', 'meals'] as const
export type FoodTodaySection = typeof FOOD_TODAY_SECTIONS[number]

export const FOOD_TODAY_BOARD: BoardLayouts<FoodTodaySection> = {
  1: ['nutrition', 'meals', 'water', 'fits', 'guess', 'history', 'coach'],
  2: { lead: 1, columns: [['nutrition', 'water', 'fits', 'guess'], ['meals', 'history', 'coach']] },
  3: { lead: 1, columns: [['nutrition', 'water', 'fits', 'guess'], ['meals', 'history'], ['coach']] },
  4: { lead: 1, columns: [['nutrition', 'water'], ['meals', 'history'], ['fits', 'guess'], ['coach']] },
}

// ── Ingredients ─────────────────────────────────────────────────────────────
// The add/edit form is a sticky rail on the left; the food list takes every
// other track and splits its rows into columns by its own width (one column
// up to 68rem, two to 100rem, three beyond), so a long library reads across
// the screen instead of down it.
export const INGREDIENT_SECTIONS = ['form', 'list'] as const
export type IngredientSection = typeof INGREDIENT_SECTIONS[number]

export const INGREDIENT_BOARD: BoardLayouts<IngredientSection> = {
  1: ['form', 'list'],
  2: { lead: 1, columns: [{ stack: ['form'], sticky: true }, ['list']] },
  3: { lead: 1, columns: [{ stack: ['form'], sticky: true }, { stack: ['list'], span: 2 }] },
  4: { lead: 1, columns: [{ stack: ['form'], sticky: true }, { stack: ['list'], span: 3 }] },
}

// ── Insights ────────────────────────────────────────────────────────────────
// The window's averages and macro split lead (main); the source lists are
// columns beside it, so a wide screen shows calories, protein and habits at
// once:
//   1  phone, tablet — summary, meals, calories, protein, most logged.
//   2  1280 / 1469 — summary + calorie sources | meals + protein + most logged.
//   3  1920 — summary + calorie sources | protein | meals + most logged.
//   4  2450 — summary + calorie sources | protein | most logged | meals.
export const INSIGHT_SECTIONS = ['summary', 'slots', 'kcal', 'protein', 'most'] as const
export type InsightSection = typeof INSIGHT_SECTIONS[number]

export const INSIGHT_BOARD: BoardLayouts<InsightSection> = {
  1: ['summary', 'slots', 'kcal', 'protein', 'most'],
  2: { columns: [['summary', 'kcal'], ['slots', 'protein', 'most']] },
  3: { columns: [['summary', 'kcal'], ['protein'], ['slots', 'most']] },
  4: { columns: [['summary', 'kcal'], ['protein'], ['most'], ['slots']] },
}
