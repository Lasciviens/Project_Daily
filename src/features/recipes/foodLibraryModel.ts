// The Library (recipes) and Ingredients lists: usage from the diary, macro
// density, filters and sorts. Pure (scripts/verify-food-library.cjs).
import { foldText, rankMatches } from './foodSearch'
import type { FoodCategory, IngredientLibraryItem, MealSlot, RecipeWithIngredients } from './types'

// ── Usage from the diary ────────────────────────────────────────────────────
/** One eaten diary row, as much as usage needs. */
export interface UsageRow {
  date: string
  meal_slot: MealSlot
  library_ingredient_id: string | null
  recipe_id: string | null
  calories: number | null
  protein_g: number | null
}

export interface Usage {
  /** Times logged in the window. */
  count: number
  /** Latest day it was eaten (yyyy-MM-dd). */
  lastDate: string
  kcal: number
  protein: number
}

export const usageKey = {
  recipe: (id: string) => `r:${id}`,
  ingredient: (id: string) => `i:${id}`,
}

/** Times eaten, last day and totals per recipe and per library food. */
export function buildUsage(rows: readonly UsageRow[]): Map<string, Usage> {
  const out = new Map<string, Usage>()
  for (const r of rows) {
    const key = r.recipe_id ? usageKey.recipe(r.recipe_id) : r.library_ingredient_id ? usageKey.ingredient(r.library_ingredient_id) : null
    if (!key) continue
    const u = out.get(key) ?? { count: 0, lastDate: r.date, kcal: 0, protein: 0 }
    u.count++
    if (r.date > u.lastDate) u.lastDate = r.date
    u.kcal += r.calories ?? 0
    u.protein += r.protein_g ?? 0
    out.set(key, u)
  }
  return out
}

// ── Macro helpers ───────────────────────────────────────────────────────────
/** Grams of protein per 100 kcal — how "protein-dense" a food is (≥ 8 is very lean). */
export function proteinDensity(kcal: number | null | undefined, protein: number | null | undefined): number | null {
  if (kcal == null || protein == null || kcal <= 0) return null
  return Math.round((protein / kcal) * 1000) / 10
}

export const hasMacros = (m: { calories: number | null; protein_g: number | null }) => m.calories != null && m.calories > 0

/** High protein: at least 25 g a serving, or 8 g per 100 kcal with at least 10 g. */
export function isHighProtein(kcal: number | null, protein: number | null): boolean {
  if (protein == null) return false
  if (protein >= 25) return true
  const d = proteinDensity(kcal, protein)
  return d != null && d >= 8 && protein >= 10
}

// ── Recipes (Library) ───────────────────────────────────────────────────────
export type RecipeSort = 'recent' | 'most' | 'protein' | 'density' | 'kcal-low' | 'kcal-high' | 'cooked' | 'az' | 'new'
export type RecipeFlag = 'fits' | 'high-protein' | 'light' | 'no-macros' | 'saved'

export const RECIPE_SORTS: { value: RecipeSort; label: string }[] = [
  { value: 'recent', label: 'Recently eaten' },
  { value: 'most', label: 'Most eaten' },
  { value: 'protein', label: 'Most protein' },
  { value: 'density', label: 'Protein per kcal' },
  { value: 'kcal-low', label: 'Fewest kcal' },
  { value: 'kcal-high', label: 'Most kcal' },
  { value: 'cooked', label: 'Most cooked' },
  { value: 'new', label: 'Newest' },
  { value: 'az', label: 'A–Z' },
]

export const RECIPE_FLAGS: { value: RecipeFlag; label: string; hint: string }[] = [
  { value: 'fits', label: 'Fits today', hint: "One serving fits the calories you have left today" },
  { value: 'high-protein', label: 'High protein', hint: '25 g+ a serving, or 8 g+ per 100 kcal' },
  { value: 'light', label: 'Under 500 kcal', hint: 'A serving under 500 kcal' },
  { value: 'no-macros', label: 'No macros', hint: 'No calories set yet' },
  { value: 'saved', label: 'Saved meals', hint: 'Meals saved from the logger (hidden from the Library otherwise)' },
]

/** Light meal: a serving with calories under 500. */
const LIGHT_KCAL = 500

export interface RecipeFilter {
  query: string
  category: FoodCategory | 'all'
  flags: RecipeFlag[]
  /** Calories still open today — what "Fits today" compares a serving with. */
  kcalLeft?: number | null
}

const isLight = (kcal: number | null | undefined) => kcal != null && kcal > 0 && kcal < LIGHT_KCAL

export function filterRecipes(recipes: readonly RecipeWithIngredients[], f: RecipeFilter): RecipeWithIngredients[] {
  const q = foldText(f.query)
  const saved = f.flags.includes('saved')
  return recipes.filter(r => {
    // Saved meals stay out of the Library unless asked for; asked for, only they show.
    if (saved !== r.is_temp) return false
    if (f.category !== 'all' && r.category !== f.category) return false
    if (f.flags.includes('fits') && !fitsCalories(r.calories, f.kcalLeft)) return false
    if (f.flags.includes('high-protein') && !isHighProtein(r.calories, r.protein_g)) return false
    if (f.flags.includes('light') && !isLight(r.calories)) return false
    if (f.flags.includes('no-macros') && hasMacros(r)) return false
    if (!q) return true
    return foldText(r.title).includes(q) || foldText(r.description ?? '').includes(q) || r.ingredients.some(i => foldText(i.name).includes(q))
  })
}

export function sortRecipes(recipes: readonly RecipeWithIngredients[], sort: RecipeSort, usage: Map<string, Usage>): RecipeWithIngredients[] {
  const u = (r: RecipeWithIngredients) => usage.get(usageKey.recipe(r.id))
  const byTitle = (a: RecipeWithIngredients, b: RecipeWithIngredients) => a.title.localeCompare(b.title)
  // Unknown values (no macros, never eaten) always go last, whatever the direction.
  const num = (get: (r: RecipeWithIngredients) => number | null | undefined, dir: 1 | -1) =>
    (a: RecipeWithIngredients, b: RecipeWithIngredients) => {
      const x = get(a), y = get(b)
      if (x == null && y == null) return byTitle(a, b)
      if (x == null) return 1
      if (y == null) return -1
      return (x - y) * dir || byTitle(a, b)
    }
  const posKcal = (r: RecipeWithIngredients) => (r.calories != null && r.calories > 0 ? r.calories : null)
  const cmp: Record<RecipeSort, (a: RecipeWithIngredients, b: RecipeWithIngredients) => number> = {
    recent: (a, b) => {
      const x = u(a)?.lastDate, y = u(b)?.lastDate
      if (x && y) return y.localeCompare(x) || byTitle(a, b)
      if (x) return -1
      if (y) return 1
      return b.updated_at.localeCompare(a.updated_at) || byTitle(a, b)
    },
    most: num(r => u(r)?.count, -1),
    protein: num(r => r.protein_g, -1),
    density: num(r => proteinDensity(r.calories, r.protein_g), -1),
    'kcal-low': num(posKcal, 1),
    'kcal-high': num(posKcal, -1),
    cooked: num(r => (r.times_cooked > 0 ? r.times_cooked : null), -1),
    new: (a, b) => b.created_at.localeCompare(a.created_at) || byTitle(a, b),
    az: byTitle,
  }
  return [...recipes].sort(cmp[sort])
}

// ── Today's room (Library "Fits today") ─────────────────────────────────────
/** Calories and protein still open today: the targets minus what was eaten (negative when over). */
export function dayRemaining(
  targets: { calories: number; protein: number },
  eaten: { calories?: number | null; protein_g?: number | null } | null | undefined,
): { kcal: number; protein: number } {
  return {
    kcal: Math.round(targets.calories - (eaten?.calories ?? 0)),
    protein: Math.round(targets.protein - (eaten?.protein_g ?? 0)),
  }
}

// ── Today's four targets (Today → "What's left") ────────────────────────────
/** Fat's share of the calorie goal: the middle of the usual 20–35 % range. */
export const FAT_SHARE = 0.3

export type DayMacro = 'kcal' | 'protein' | 'carbs' | 'fat'
export interface DayMacroTargets { kcal: number; protein: number; carbs: number; fat: number }

/**
 * The day's four targets from the goal. The goal (day_targets) sets calories
 * and protein; carbs and fat split what the calories leave: fat is 30 % of
 * the calories (never under the coach's fat floor when it gives one — a cut
 * with a known weight), carbs are the rest after protein and fat (4/4/9 kcal
 * per gram), never below 0.
 */
export function dayMacroTargets(goal: { calories: number; protein: number }, fatFloorG?: number | null): DayMacroTargets {
  const kcal = Math.max(0, Math.round(goal.calories))
  const protein = Math.max(0, Math.round(goal.protein))
  const fat = Math.round(Math.max((kcal * FAT_SHARE) / 9, fatFloorG ?? 0))
  const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4))
  return { kcal, protein, carbs, fat }
}

export interface MacroLeft {
  key: DayMacro
  target: number
  eaten: number
  /** Target minus eaten, rounded; negative when over. */
  left: number
  /** How much of the target is eaten, 0–1 (1 when over or with no target). */
  share: number
}

/** What is left of each target today (kcal, protein, carbs, fat — in that order). */
export function macrosLeft(
  t: DayMacroTargets,
  eaten: { calories?: number | null; protein_g?: number | null; carbs_g?: number | null; fat_g?: number | null } | null | undefined,
): MacroLeft[] {
  const got: Record<DayMacro, number> = {
    kcal: eaten?.calories ?? 0, protein: eaten?.protein_g ?? 0, carbs: eaten?.carbs_g ?? 0, fat: eaten?.fat_g ?? 0,
  }
  return (['kcal', 'protein', 'carbs', 'fat'] as const).map(key => {
    const target = t[key]
    const e = Math.round(got[key])
    return { key, target, eaten: e, left: target - e, share: target > 0 ? Math.min(1, e / target) : (e > 0 ? 1 : 0) }
  })
}

/** One portion fits when its calories are known and no more than what is left. */
export function fitsCalories(kcal: number | null | undefined, kcalLeft: number | null | undefined): boolean {
  return kcal != null && kcal > 0 && kcalLeft != null && kcal <= kcalLeft
}

// ── Foods in the Library search ─────────────────────────────────────────────
/** A library food as the Library offers it: the portion + logs (its preset, else 100 g / ml) and what that portion gives. */
export interface FoodHit {
  food: IngredientLibraryItem
  grams: number
  /** "1 scoop (30 g)" or "100 g". */
  portion: string
  kcal: number | null
  protein: number | null
}

export function defaultPortion(f: IngredientLibraryItem): FoodHit {
  const unit = f.unit?.trim().toLowerCase() === 'ml' ? 'ml' : 'g'
  const p = portionMacros(f)
  if (p) return { food: f, grams: p.grams, portion: `${f.serving_label || 'portion'} (${Math.round(p.grams)} ${unit})`, kcal: p.calories, protein: p.protein_g }
  return { food: f, grams: 100, portion: `100 ${unit}`, kcal: f.calories == null ? null : Math.round(f.calories), protein: f.protein_g }
}

/**
 * Library foods matching the search (ranked like the logger, accents folded),
 * under the same quick filters as the recipes — judged on the portion + would
 * log. A meal-type category or the Saved meals view shows recipes only.
 */
export function searchFoods(foods: readonly IngredientLibraryItem[], f: RecipeFilter, limit = 8): FoodHit[] {
  if (!f.query.trim() || f.category !== 'all' || f.flags.includes('saved')) return []
  const ranked = rankMatches([...foods], f.query, x => x.name, foods.length).map(defaultPortion)
  return ranked.filter(h => {
    if (f.flags.includes('fits') && !fitsCalories(h.kcal, f.kcalLeft)) return false
    if (f.flags.includes('high-protein') && !isHighProteinFood(h.food)) return false
    if (f.flags.includes('light') && !isLight(h.kcal)) return false
    if (f.flags.includes('no-macros') && hasMacros(h.food)) return false
    return true
  }).slice(0, limit)
}

// ── Library foods (Ingredients) ─────────────────────────────────────────────
export type FoodSort = 'az' | 'recent' | 'most' | 'protein' | 'density' | 'kcal-low' | 'kcal-high' | 'new'
export type FoodFlag = 'high-protein' | 'used' | 'unused' | 'no-macros' | 'mismatch'

export const FOOD_SORTS: { value: FoodSort; label: string }[] = [
  { value: 'az', label: 'A–Z' },
  { value: 'recent', label: 'Recently eaten' },
  { value: 'most', label: 'Most eaten' },
  { value: 'protein', label: 'Most protein' },
  { value: 'density', label: 'Protein per kcal' },
  { value: 'kcal-low', label: 'Fewest kcal' },
  { value: 'kcal-high', label: 'Most kcal' },
  { value: 'new', label: 'Newest' },
]

export const FOOD_FLAGS: { value: FoodFlag; label: string }[] = [
  { value: 'high-protein', label: 'High protein' },
  { value: 'used', label: 'Eaten lately' },
  { value: 'unused', label: 'Not eaten lately' },
  { value: 'no-macros', label: 'No macros' },
  { value: 'mismatch', label: "Macros don't add up" },
]

/** Per 100 g: 20 g+ protein, or 8 g+ per 100 kcal with 10 g+. */
export function isHighProteinFood(f: Pick<IngredientLibraryItem, 'calories' | 'protein_g'>): boolean {
  if (f.protein_g == null) return false
  if (f.protein_g >= 20) return true
  const d = proteinDensity(f.calories, f.protein_g)
  return d != null && d >= 8 && f.protein_g >= 10
}

/** Calories that don't match 4·P + 4·C + 9·F by more than 50 kcal or 15 % (same rule as macroSanity). */
export function macrosMismatch(f: Pick<IngredientLibraryItem, 'calories' | 'protein_g' | 'carbs_g' | 'fat_g'>): boolean {
  if (f.calories == null || f.protein_g == null || f.carbs_g == null || f.fat_g == null) return false
  const implied = 4 * f.protein_g + 4 * f.carbs_g + 9 * f.fat_g
  const gap = Math.abs(implied - f.calories)
  return gap > Math.max(50, f.calories * 0.15)
}

export interface FoodFilter {
  query: string
  group: string | null   // a food group, '__other' for none, null for all
  flags: FoodFlag[]
}

export function filterFoods(foods: readonly IngredientLibraryItem[], f: FoodFilter, usage: Map<string, Usage>, recipeUse: Map<string, number>): IngredientLibraryItem[] {
  const q = foldText(f.query)
  return foods.filter(i => {
    if (q && !foldText(i.name).includes(q)) return false
    if (f.group === '__other' ? !!i.food_group : f.group && i.food_group !== f.group) return false
    const used = usage.has(usageKey.ingredient(i.id)) || (recipeUse.get(i.id) ?? 0) > 0
    if (f.flags.includes('high-protein') && !isHighProteinFood(i)) return false
    if (f.flags.includes('used') && !used) return false
    if (f.flags.includes('unused') && used) return false
    if (f.flags.includes('no-macros') && hasMacros(i)) return false
    if (f.flags.includes('mismatch') && !macrosMismatch(i)) return false
    return true
  })
}

export function sortFoods(foods: readonly IngredientLibraryItem[], sort: FoodSort, usage: Map<string, Usage>): IngredientLibraryItem[] {
  const u = (i: IngredientLibraryItem) => usage.get(usageKey.ingredient(i.id))
  const byName = (a: IngredientLibraryItem, b: IngredientLibraryItem) => a.name.localeCompare(b.name)
  const num = (get: (i: IngredientLibraryItem) => number | null | undefined, dir: 1 | -1) =>
    (a: IngredientLibraryItem, b: IngredientLibraryItem) => {
      const x = get(a), y = get(b)
      if (x == null && y == null) return byName(a, b)
      if (x == null) return 1
      if (y == null) return -1
      return (x - y) * dir || byName(a, b)
    }
  const posKcal = (i: IngredientLibraryItem) => (i.calories != null && i.calories > 0 ? i.calories : null)
  const cmp: Record<FoodSort, (a: IngredientLibraryItem, b: IngredientLibraryItem) => number> = {
    az: byName,
    recent: (a, b) => {
      const x = u(a)?.lastDate, y = u(b)?.lastDate
      if (x && y) return y.localeCompare(x) || byName(a, b)
      if (x) return -1
      if (y) return 1
      return byName(a, b)
    },
    most: num(i => u(i)?.count, -1),
    protein: num(i => i.protein_g, -1),
    density: num(i => proteinDensity(i.calories, i.protein_g), -1),
    'kcal-low': num(posKcal, 1),
    'kcal-high': num(posKcal, -1),
    new: (a, b) => b.created_at.localeCompare(a.created_at) || byName(a, b),
  }
  return [...foods].sort(cmp[sort])
}

/** How many recipes (Library and saved meals) use each library food. */
export function recipeUseCounts(recipes: readonly RecipeWithIngredients[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const r of recipes) {
    const seen = new Set<string>()
    for (const i of r.ingredients) if (i.library_ingredient_id && !seen.has(i.library_ingredient_id)) {
      seen.add(i.library_ingredient_id)
      out.set(i.library_ingredient_id, (out.get(i.library_ingredient_id) ?? 0) + 1)
    }
  }
  return out
}

/** A food's macros for one portion (its preset), rounded for display. */
export function portionMacros(f: Pick<IngredientLibraryItem, 'calories' | 'protein_g' | 'carbs_g' | 'fat_g' | 'serving_grams'>) {
  if (f.serving_grams == null || f.serving_grams <= 0) return null
  const k = f.serving_grams / 100
  const r = (v: number | null) => (v == null ? null : Math.round(v * k * 10) / 10)
  return { grams: f.serving_grams, calories: f.calories == null ? null : Math.round(f.calories * k), protein_g: r(f.protein_g), carbs_g: r(f.carbs_g), fat_g: r(f.fat_g) }
}

// ── What fits what's left today ─────────────────────────────────────────────
export interface FitSuggestion {
  key: string
  kind: 'recipe' | 'food'
  id: string
  title: string
  /** Portion text: "1 serving", "1 scoop (30 g)", "100 g". */
  portion: string
  /** Amount to log: servings for a recipe, grams for a food. */
  quantity: number
  kcal: number
  protein: number
  /** Times eaten in the usage window. */
  eaten: number
}

/**
 * Your own recipes and foods whose one portion fits the calories left and
 * closes as much of the protein gap as possible per kcal. Foods count only when
 * you have eaten them lately or gave them a portion — a familiar shortlist, not
 * the whole food table. Empty when little protein or few calories are left.
 */
export function suggestForRemaining(opts: {
  recipes: readonly RecipeWithIngredients[]
  foods: readonly IngredientLibraryItem[]
  usage: Map<string, Usage>
  kcalLeft: number
  proteinLeft: number
  limit?: number
}): FitSuggestion[] {
  const { recipes, foods, usage, kcalLeft, proteinLeft, limit = 5 } = opts
  if (proteinLeft < 10 || kcalLeft < 80) return []
  const out: FitSuggestion[] = []
  for (const r of recipes) {
    if (!hasMacros(r) || r.protein_g == null || r.protein_g < 8) continue
    out.push({ key: usageKey.recipe(r.id), kind: 'recipe', id: r.id, title: r.title, portion: '1 serving', quantity: 1,
      kcal: Math.round(r.calories!), protein: Math.round(r.protein_g), eaten: usage.get(usageKey.recipe(r.id))?.count ?? 0 })
  }
  for (const f of foods) {
    if (!hasMacros(f) || f.protein_g == null) continue
    const eaten = usage.get(usageKey.ingredient(f.id))?.count ?? 0
    if (eaten === 0 && !f.serving_label) continue
    const p = portionMacros(f)
    const grams = p?.grams ?? 100
    const kcal = p?.calories ?? Math.round(f.calories!)
    const protein = Math.round(p?.protein_g ?? f.protein_g)
    if (protein < 5) continue
    const unit = f.unit?.trim().toLowerCase() === 'ml' ? 'ml' : 'g'
    out.push({ key: usageKey.ingredient(f.id), kind: 'food', id: f.id, title: f.name,
      portion: p ? `${f.serving_label || 'portion'} (${Math.round(grams)} ${unit})` : `100 ${unit}`, quantity: grams, kcal, protein, eaten })
  }
  const score = (s: FitSuggestion) => Math.min(s.protein, proteinLeft) / Math.max(s.kcal, 50) + Math.min(s.eaten, 10) * 0.003
  return out
    .filter(s => s.kcal > 0 && s.kcal <= kcalLeft)
    .sort((a, b) => score(b) - score(a) || a.title.localeCompare(b.title))
    .slice(0, limit)
}
