// What a diary line is made of: the foods behind each of Today's macro totals
// (the peek on "71g fat") and the most used ingredients over an Insights
// window. Pure (scripts/verify-food-ingredients.cjs); eaten lines only.
//
// A line splits into foods only where the model knows them: a library food is
// itself; a recipe splits into its ingredients (grams × the servings eaten ÷
// the recipe's servings). For a day's macro totals only a from-ingredients
// recipe splits — its totals ARE its foods, scaled so the parts add up to the
// line exactly; a recipe with typed macros stays one line. A one-off line
// (custom title) has no foods.
import { toGrams } from './foodUnits'
import { foldText } from './foodSearch'

export const MACRO_KEYS = ['calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'sugar_g'] as const
export type MacroKey = typeof MACRO_KEYS[number]
export type MacroAmounts = Record<MacroKey, number>

/** kcal per gram where it makes sense to say it (4/4/9; sugar is a carb; fibre is left out). */
export const KCAL_PER_GRAM: Partial<Record<MacroKey, number>> = { protein_g: 4, carbs_g: 4, fat_g: 9, sugar_g: 4 }

export interface LibraryFood {
  id: string
  name: string
  unit?: string | null
  calories: number | null; protein_g: number | null; carbs_g: number | null
  fat_g: number | null; fiber_g: number | null; sugar_g: number | null
}

export interface RecipeSource {
  id: string
  title: string
  servings: number
  macro_mode: string
  ingredients: { name: string; quantity: number | null; unit: string | null; library_ingredient_id: string | null }[]
}

/** One eaten diary line. `macros` are the line's own stored totals, unrounded. */
export interface DiaryLine {
  title: string
  library_ingredient_id: string | null
  recipe_id: string | null
  /** Grams / ml for a food, servings eaten for a recipe. */
  quantity: number | null
  unit: string | null
  macros: MacroAmounts
}

type Lookup<T> = ReadonlyMap<string, T>

const n = (v: unknown): number => {
  const x = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(x) ? x : 0
}
const VOLUME = /^(ml|millilit(er|re)s?|cl|dl|l|lit(er|re)s?)$/i
const zero = (): MacroAmounts => ({ calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0, sugar_g: 0 })

/** Any macro-carrying row as exact amounts (nulls and strings count as 0). */
export function macroAmounts(row: Partial<Record<MacroKey, unknown>>): MacroAmounts {
  const out = zero()
  for (const k of MACRO_KEYS) out[k] = n(row[k])
  return out
}

// `DayMeal.title` bakes the amount into the string ("Chicken · 150g"). Only a
// tail that starts with a digit is a quantity — a food name that itself
// contains " · " must not be chopped in two.
export function splitTitleQty(title: string): { name: string; qty: string | null } {
  const idx = title.lastIndexOf(' · ')
  if (idx === -1) return { name: title, qty: null }
  const qty = title.slice(idx + 3)
  if (!/^\d/.test(qty)) return { name: title, qty: null }
  return { name: title.slice(0, idx), qty }
}

/**
 * The day's eaten totals as the Nutrition card shows them: every eaten line's
 * exact values summed, rounded once — so a figure is the peek's exact total
 * rounded ("8.4 g" → "8g"), and many small parts never round away to 0.
 */
export function eatenTotals(meals: readonly ({ source: 'plan' | 'log'; exact?: MacroAmounts } & MacroAmounts)[]): MacroAmounts {
  const out = zero()
  for (const m of meals) {
    if (m.source !== 'log') continue
    for (const k of MACRO_KEYS) out[k] += m.exact?.[k] ?? m[k]
  }
  for (const k of MACRO_KEYS) out[k] = Math.round(out[k])
  return out
}

/** Today's DayMeal (eaten rows only) as a diary line; its exact values when it carries them. */
export function diaryLineFromMeal(m: {
  title: string
  source: 'plan' | 'log'
  exact?: MacroAmounts
  logEntry?: { library_ingredient_id: string | null; recipe_id: string | null; quantity: number | null; unit: string | null }
} & MacroAmounts): DiaryLine | null {
  if (m.source !== 'log') return null
  return {
    title: splitTitleQty(m.title).name,
    library_ingredient_id: m.logEntry?.library_ingredient_id ?? null,
    recipe_id: m.logEntry?.recipe_id ?? null,
    quantity: m.logEntry?.quantity ?? null,
    unit: m.logEntry?.unit ?? null,
    macros: m.exact ?? macroAmounts(m),
  }
}

export interface IngredientPart {
  key: string
  title: string
  libraryId: string | null
  /** Grams (or ml) eaten, or null when the unit can't be counted ("2 pcs"). */
  grams: number | null
  unit: 'g' | 'ml'
  /** What those grams hold by the library's per-100 g values; null without a linked food or a weight. */
  macros: MacroAmounts | null
}

/**
 * A recipe's ingredients for `servingsEaten` of its `servings`; the same food
 * listed twice is one part. A row with neither a library link nor a weight
 * ("Salt, to taste", "Pepper, 1 pinch") is left out: it says nothing about
 * what was eaten, and in every recipe it would top a "most used" list.
 */
export function recipeParts(recipe: RecipeSource, servingsEaten: number, library: Lookup<LibraryFood>): IngredientPart[] {
  const factor = servingsEaten / Math.max(1, n(recipe.servings))
  const parts = new Map<string, IngredientPart>()
  for (const ing of recipe.ingredients ?? []) {
    const name = (ing.name ?? '').trim()
    const libId = ing.library_ingredient_id
    const lib = libId ? library.get(libId) : undefined
    const g = toGrams(ing.quantity, ing.unit)
    if (!libId && (g == null || !name)) continue
    const grams = g == null ? null : g * factor
    let macros: MacroAmounts | null = null
    if (lib && grams != null) {
      macros = zero()
      for (const k of MACRO_KEYS) macros[k] = (n(lib[k]) * grams) / 100
    }
    const key = libId ? `i:${libId}` : `n:${foldText(name)}`
    const unit = (lib?.unit ?? '').toLowerCase() === 'ml' || VOLUME.test((ing.unit ?? '').trim()) ? 'ml' : 'g'
    const prev = parts.get(key)
    if (!prev) { parts.set(key, { key, title: lib?.name ?? name, libraryId: libId, grams, unit, macros }); continue }
    if (grams != null) prev.grams = (prev.grams ?? 0) + grams
    if (macros) {
      const sum = prev.macros ?? zero()
      for (const k of MACRO_KEYS) sum[k] += macros[k]
      prev.macros = sum
    }
  }
  return [...parts.values()]
}

export interface Contributor { key: string; title: string; macros: MacroAmounts }

/**
 * Where one line's macros come from. A from-ingredients recipe splits into its
 * linked, weighed foods, scaled per macro so the parts add up to the line's own
 * value (its stored totals win over a later rounding). A macro none of the foods
 * carry stays with the recipe itself, so nothing is lost.
 */
export function lineContributors(line: DiaryLine, recipes: Lookup<RecipeSource>, library: Lookup<LibraryFood>): Contributor[] {
  if (line.recipe_id) {
    const self: Contributor = { key: `r:${line.recipe_id}`, title: line.title, macros: line.macros }
    const recipe = recipes.get(line.recipe_id)
    if (!recipe || recipe.macro_mode !== 'from_ingredients') return [self]
    const parts = recipeParts(recipe, line.quantity ?? 1, library).filter(p => p.macros)
    if (!parts.length) return [self]
    const out: Contributor[] = parts.map(p => ({ key: p.key, title: p.title, macros: zero() }))
    const rest = zero()
    for (const k of MACRO_KEYS) {
      const sum = parts.reduce((a, p) => a + p.macros![k], 0)
      if (sum > 0) parts.forEach((p, i) => { out[i].macros[k] = (line.macros[k] * p.macros![k]) / sum })
      else rest[k] = line.macros[k]
    }
    if (MACRO_KEYS.some(k => rest[k] !== 0)) out.push({ key: self.key, title: self.title, macros: rest })
    return out
  }
  if (line.library_ingredient_id) return [{ key: `i:${line.library_ingredient_id}`, title: line.title, macros: line.macros }]
  return [{ key: `c:${foldText(line.title.trim())}`, title: line.title, macros: line.macros }]
}

export interface MacroSources {
  /** The day's exact total of the macro. */
  total: number
  /** kcal from it (4/4/9), or null where that makes no sense (calories, fibre). */
  kcal: number | null
  /** That kcal as a share of the day's calories, 0–100. */
  kcalShare: number | null
  /** Largest first; the same food from several lines is one row. */
  items: { key: string; title: string; amount: number }[]
  /** Rows past `top`, and what they add up to. */
  more: number
  moreAmount: number
}

/** The day's contributors to one macro (Today → the peek on each total). */
export function dayMacroSources(
  lines: readonly DiaryLine[], macro: MacroKey, recipes: Lookup<RecipeSource>, library: Lookup<LibraryFood>, top = 8,
): MacroSources {
  const total = lines.reduce((a, l) => a + l.macros[macro], 0)
  const dayKcal = lines.reduce((a, l) => a + l.macros.calories, 0)
  const merged = new Map<string, { key: string; title: string; amount: number }>()
  for (const line of lines) {
    for (const c of lineContributors(line, recipes, library)) {
      const prev = merged.get(c.key)
      if (prev) prev.amount += c.macros[macro]
      else merged.set(c.key, { key: c.key, title: c.title, amount: c.macros[macro] })
    }
  }
  const ranked = [...merged.values()]
    .filter(x => x.amount > 0)
    .sort((a, b) => b.amount - a.amount || a.title.localeCompare(b.title))
  const rest = ranked.slice(top)
  const per = KCAL_PER_GRAM[macro]
  const kcal = per != null ? total * per : null
  return {
    total,
    kcal,
    kcalShare: kcal != null && dayKcal > 0 ? Math.round((kcal / dayKcal) * 100) : null,
    items: ranked.slice(0, top),
    more: rest.length,
    moreAmount: rest.reduce((a, x) => a + x.amount, 0),
  }
}

/** An eaten diary row over a window (Insights). */
export interface WindowRow {
  date: string
  title: string
  library_ingredient_id: string | null
  recipe_id: string | null
  quantity: number | null
  unit: string | null
  calories: number | null
}

export interface UsedIngredient {
  key: string
  title: string
  /** Days it was eaten on, and diary lines it was in (a recipe line counts once). */
  days: number
  logs: number
  /** Grams (or ml) eaten where the amount could be counted; 0 when none could. */
  grams: number
  unit: 'g' | 'ml'
  kcal: number
  /** Share of every calorie logged in the window, 0–100. */
  kcalShare: number
  /** Share of the logged days it was eaten on, 0–100. */
  dayShare: number
}

/**
 * The foods eaten most often over a window: a food logged by itself, and the
 * foods inside every logged recipe (any recipe — what is in it is a fact even
 * when its macros were typed). Ranked by the days it was eaten on, then by the
 * lines it was in, then by grams. One-off lines have no foods and are left out.
 * A recipe ingredient's kcal is its library food's per-100 g × the grams.
 */
export function mostUsedIngredients(
  rows: readonly WindowRow[], recipes: Lookup<RecipeSource>, library: Lookup<LibraryFood>, top = 8,
): { items: UsedIngredient[]; total: number } {
  const totalKcal = rows.reduce((a, r) => a + n(r.calories), 0)
  const daysLogged = new Set(rows.map(r => r.date)).size
  const acc = new Map<string, { key: string; title: string; days: Set<string>; logs: number; grams: number; unit: 'g' | 'ml'; kcal: number }>()
  for (const r of rows) {
    let parts: { key: string; title: string; grams: number | null; unit: 'g' | 'ml'; kcal: number }[] = []
    if (r.library_ingredient_id) {
      const lib = library.get(r.library_ingredient_id)
      const unit = (lib?.unit ?? '').toLowerCase() === 'ml' || VOLUME.test((r.unit ?? '').trim()) ? 'ml' : 'g'
      parts = [{ key: `i:${r.library_ingredient_id}`, title: lib?.name ?? r.title, grams: toGrams(r.quantity, r.unit), unit, kcal: n(r.calories) }]
    } else if (r.recipe_id) {
      const recipe = recipes.get(r.recipe_id)
      if (recipe) parts = recipeParts(recipe, r.quantity ?? 1, library).map(p => ({ ...p, kcal: p.macros?.calories ?? 0 }))
    }
    for (const p of parts) {
      const a = acc.get(p.key) ?? { key: p.key, title: p.title, days: new Set<string>(), logs: 0, grams: 0, unit: p.unit, kcal: 0 }
      a.days.add(r.date); a.logs++; a.grams += p.grams ?? 0; a.kcal += p.kcal
      acc.set(p.key, a)
    }
  }
  const items = [...acc.values()]
    .sort((a, b) => b.days.size - a.days.size || b.logs - a.logs || b.grams - a.grams || a.title.localeCompare(b.title))
    .slice(0, top)
    .map(a => ({
      key: a.key, title: a.title, days: a.days.size, logs: a.logs, grams: a.grams, unit: a.unit, kcal: a.kcal,
      kcalShare: totalKcal > 0 ? Math.round((a.kcal / totalKcal) * 100) : 0,
      dayShare: daysLogged > 0 ? Math.round((a.days.size / daysLogged) * 100) : 0,
    }))
  return { items, total: acc.size }
}

/** "850 g", "5.4 kg", "330 ml", "1.2 l". */
export function formatAmount(grams: number, unit: 'g' | 'ml'): string {
  if (grams >= 1000) return `${(Math.round(grams / 100) / 10).toLocaleString('en-GB')} ${unit === 'ml' ? 'l' : 'kg'}`
  return `${Math.round(grams)} ${unit}`
}

/** One decimal, the way the peek shows an exact amount ("70.6"). */
export const oneDecimal = (v: number): string => (Math.round(v * 10) / 10).toLocaleString('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
