// ─────────────────────────────────────────────────────────────────────────────
//  The `claude` function · the recipe rules
//
//  What a recipe is, as the recipe editor holds it (src/features/ai/claude/
//  recipeJobs.ts reads the same shape again in the browser), and the one check
//  every recipe passes through, whoever made it: the model, or the code that
//  read a page's own schema.org data. A value that fails is dropped, never
//  repaired (answer-reader.ts), and a recipe with no title or no ingredient is
//  no recipe.
// ─────────────────────────────────────────────────────────────────────────────

import { answerValue, checkedLine, checkedList, checkedNumber, isPlainObject } from './answer-reader.ts'

/**
 * The language rule of the recipe jobs, in one place. The old assistant forced Turkish; the new one keeps the
 * recipe's own language. Change this one sentence to change that for every recipe job (each job's version then
 * needs a new pin in scripts/verify-claude-function.cjs).
 */
export const RECIPE_LANGUAGE_RULE = "Write the title, the ingredient names, the notes and the steps in the language of the recipe, in its own words. Never translate anything."

/** The most a per-serving value may be, for a recipe and for a diary line alike (the app's own table limits). */
export const NUTRITION_MAX = { calories: 5000, protein_g: 500, carbs_g: 1000, fat_g: 500, sugar_g: 1000 } as const
export const NUTRITION_KEYS = ['calories', 'protein_g', 'carbs_g', 'fat_g', 'sugar_g'] as const
export type NutritionKey = typeof NUTRITION_KEYS[number]

export const RECIPE_LIMITS = {
  title: 150, ingredients: 80, ingredientName: 160, unit: 24, note: 200, quantityMax: 100_000, servingsMax: 100, steps: 80, step: 1500,
} as const

/** A recipe as the recipe editor takes it (its ParsedRecipe). */
export interface RecipeFields {
  title: string
  servings: number
  /** One step per line, or null. */
  instructions: string | null
  ingredients: { name: string; quantity: number | null; unit: string | null; note: string | null }[]
  /** Per serving; a value the answer did not give properly is null; the whole thing is null when none was. */
  macro_estimate: Record<NutritionKey, number | null> | null
}

/** A whole number from `min` to `max` after rounding; anything else is null. */
function wholeNumber(value: unknown, max: number): number | null {
  const n = checkedNumber(value, 0, max)
  return n === null ? null : Math.round(n)
}

/** The per-serving values of an answer: each one whole and in range, or null. The object is null when none is. */
export function checkedNutrition(raw: unknown): Record<NutritionKey, number | null> | null {
  if (!isPlainObject(raw)) return null
  const out = {} as Record<NutritionKey, number | null>
  for (const key of NUTRITION_KEYS) out[key] = wholeNumber(answerValue(raw, key), NUTRITION_MAX[key])
  return NUTRITION_KEYS.some(key => out[key] !== null) ? out : null
}

/**
 * A recipe answer as the editor takes it. `raw` is `{ title, servings, ingredients: [{ name, quantity, unit, note }],
 * steps: [text], macros: { calories, protein_g, carbs_g, fat_g, sugar_g } }`; only the keys read here exist after
 * this. A missing or wrong servings count is 1, which is also what the editor itself assumes.
 */
export function cleanRecipe(raw: unknown): { ok: true; recipe: RecipeFields } | { ok: false; problem: string } {
  if (!isPlainObject(raw)) return { ok: false, problem: 'it was not a recipe' }
  const ingredients: RecipeFields['ingredients'] = []
  for (const item of checkedList(answerValue(raw, 'ingredients'), RECIPE_LIMITS.ingredients)) {
    if (!isPlainObject(item)) continue
    const name = checkedLine(answerValue(item, 'name'), RECIPE_LIMITS.ingredientName)
    if (!name) continue
    const quantity = checkedNumber(answerValue(item, 'quantity'), 0, RECIPE_LIMITS.quantityMax)
    ingredients.push({
      name,
      quantity: quantity !== null && quantity > 0 ? Math.round(quantity * 1000) / 1000 : null,
      unit: checkedLine(answerValue(item, 'unit'), RECIPE_LIMITS.unit),
      note: checkedLine(answerValue(item, 'note'), RECIPE_LIMITS.note),
    })
  }
  // No ingredients is checked before the title: a text that is not a recipe has neither, and that is the clearer thing to say.
  if (!ingredients.length) return { ok: false, problem: 'it found no ingredients, so the text is probably not a recipe' }
  const title = checkedLine(answerValue(raw, 'title'), RECIPE_LIMITS.title)
  if (!title) return { ok: false, problem: 'it gave no title' }
  const servings = checkedNumber(answerValue(raw, 'servings'), 1, RECIPE_LIMITS.servingsMax)
  const steps: string[] = []
  for (const step of checkedList(answerValue(raw, 'steps'), RECIPE_LIMITS.steps)) {
    const line = checkedLine(step, RECIPE_LIMITS.step)
    if (line) steps.push(line)
  }
  return {
    ok: true,
    recipe: {
      title,
      servings: servings === null ? 1 : Math.round(servings),
      instructions: steps.length ? steps.join('\n') : null,
      ingredients,
      macro_estimate: checkedNutrition(answerValue(raw, 'macros')),
    },
  }
}
