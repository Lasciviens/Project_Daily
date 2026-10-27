// The day's food for Personal's Food summary and its popup. Pure: runtime
// imports only from foodIngredients (THE eaten totals), checked by
// scripts/verify-personal-glance.cjs.

import { eatenTotals, type MacroAmounts } from '../recipes/foodIngredients'

type MealLike = { source: 'plan' | 'log'; meal_slot: string; title: string; calories: number; exact?: MacroAmounts } & MacroAmounts

export interface DayFoodTotals extends MacroAmounts {
  /** A day still to come: the totals are what is planned for it. */
  planned: boolean
}

/**
 * Up to today the totals are what was EATEN — Food's own eatenTotals (a
 * planned row never counts); a day still to come shows what is planned for
 * it, labelled as planned.
 */
export function dayFoodTotals(meals: readonly MealLike[], date: string, today: string): DayFoodTotals {
  if (date <= today) return { ...eatenTotals(meals), planned: false }
  const asEaten = meals.filter(m => m.source === 'plan').map(m => ({ ...m, source: 'log' as const }))
  return { ...eatenTotals(asEaten), planned: true }
}

export const MEAL_ORDER = ['breakfast', 'lunch', 'dinner', 'snack', 'supplement'] as const
export const MEAL_NAME: Record<string, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snacks', supplement: 'Supplements' }

export interface MealGroup<M> {
  slot: string
  name: string
  /** Eaten kcal (planned rows never count). */
  kcal: number
  items: M[]
}

/** The day's meals in the day's order, each with its eaten kcal; empty meals left out. */
export function mealsBySlot<M extends MealLike>(meals: readonly M[]): MealGroup<M>[] {
  const known = new Set<string>(MEAL_ORDER)
  const slots = [...MEAL_ORDER, ...new Set(meals.map(m => m.meal_slot).filter(s => !known.has(s)))]
  return slots
    .map(slot => {
      const items = meals.filter(m => m.meal_slot === slot)
      return { slot, name: MEAL_NAME[slot] ?? slot, kcal: eatenTotals(items).calories, items }
    })
    .filter(g => g.items.length > 0)
}

/** Whole litres with no decimals (2), partials with two (1.25) — the water tracker's numbers. */
export function litres(ml: number): string {
  return (ml / 1000).toFixed(ml % 1000 === 0 ? 0 : 2)
}
