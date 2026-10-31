// How much of something you ate, in the units it has (owner, 16.10.2026,
// Food point 8). One model behind the shared AmountField — the logger's
// portion sheet, Edit entry and RecipeDetail's "I ate this":
//   a food   → g (or ml) and its preset ("1 scoop" = 30 g);
//   a recipe → its portion name ("piece"; "portion" when none), % of the
//              batch, g raw (every ingredient weighs), g cooked (the pot of
//              the current batch was weighed).
// What is stored never changes: grams / ml for a food, servings for a recipe
// (the "base"). A unit is only a way to type and read it.
//
// Leftovers are derived, never stored (8.3): what is left of a batch = its
// servings − the servings of this recipe eaten since it started (diary rows
// created since then, on its day or later). A batch ends when it is eaten up
// or after BATCH_DAYS. Pure (scripts/verify-food-library.cjs).
import { toGrams } from './foodUnits'

export type AmountUnitId = 'g' | 'ml' | 'preset' | 'portion' | 'pct' | 'raw' | 'cooked'

export interface AmountUnit {
  id: AmountUnitId
  /** What the unit select says ("g", "scoop", "piece", "% of batch", "g raw"). */
  label: string
  /** Base (grams / ml, or servings) in one of this unit. */
  perUnit: number
  /** count: steps by one (½ under 1) · weight: by 10 · percent: by 5. */
  kind: 'count' | 'weight' | 'percent'
  /** The count's word for one ("scoop", "piece"), for chips and hints. */
  word?: string
}

export interface AmountModel {
  /** What the base is: grams or ml for a food, servings for a recipe. */
  base: 'g' | 'ml' | 'serving'
  units: AmountUnit[]
  /** The unit the field opens in. */
  start: AmountUnitId
  /** A recipe: one serving's word and the batch the % counts against. */
  portionWord?: string
  batchServings?: number
}

export interface AmountChip { label: string; hint?: string; base: number }

// ── Words and numbers ───────────────────────────────────────────────────────

/**
 * The portion words offered wherever a portion is named (owner, 31.10.2026: "there are no type of portion, it's
 * manually written like '1 portion' '1 pc' … It should be options") — a food's preset ("1 slice") and a recipe's
 * serving word. The owner's own words already in use are offered after these (portionWordOptions), and "Other…"
 * still takes a new one.
 */
export const PORTION_WORDS = [
  'portion', 'serving', 'piece', 'slice', 'scoop', 'cup', 'glass', 'bowl', 'plate',
  'bar', 'can', 'bottle', 'pack', 'tablespoon', 'teaspoon', 'handful',
] as const

/** A word fit to be offered: letters (any language), spaces and hyphens, at most 30 — never "2 slices (60 g)". */
const OFFERABLE = /^[\p{L}][\p{L} -]{0,29}$/u

/**
 * The words a portion field offers: the usual ones, then the owner's own in use (foods' presets, recipes' serving
 * words — each once, any case), then the current value if it is none of them, so a saved word always shows.
 */
export function portionWordOptions(own: readonly (string | null | undefined)[], current = ''): string[] {
  const out: string[] = [...PORTION_WORDS]
  const has = (w: string) => out.some(x => x.toLowerCase() === w.toLowerCase())
  for (const raw of own) {
    const w = raw?.trim()
    if (w && OFFERABLE.test(w) && !has(w)) out.push(w)
  }
  const c = current.trim()
  if (c && !has(c)) out.push(c)
  return out
}

/** One serving's word: the recipe's own (157) or "portion". */
export const portionWord = (label: string | null | undefined): string => label?.trim() || 'portion'

/** "piece" → "pieces", "glass" → "glasses", "berry" → "berries"; one or less (½ portion) stays one. */
export function plural(word: string, n: number): string {
  if (n > 0 && n <= 1 + 1e-9) return word
  if (/(s|x|z|ch|sh)$/i.test(word)) return `${word}es`
  if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`
  return `${word}s`
}

const FRACTIONS: Record<string, string> = { '0.25': '¼', '0.5': '½', '0.75': '¾' }

/** A count as people say it: ½, 1, 1½, 2¼, else one decimal (2.3). */
export function formatCount(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0'
  const whole = Math.floor(n + 1e-9)
  const frac = Math.round((n - whole) * 100) / 100
  const f = FRACTIONS[String(frac)]
  if (frac === 0) return String(whole)
  if (f) return whole === 0 ? f : `${whole}${f}`
  return String(Math.round(n * 10) / 10)
}

/** "3 pieces", "½ portion", "1 scoop". */
export const countLabel = (n: number, word: string): string => `${formatCount(n)} ${plural(word, n)}`

/** A typed number for the box: whole, or up to 1 decimal (2 under 1). */
export function amountText(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return ''
  const r = v < 1 ? Math.round(v * 100) / 100 : Math.round(v * 10) / 10
  return String(r)
}

// ── Models ──────────────────────────────────────────────────────────────────

export interface FoodLike { unit?: string | null; serving_label: string | null; serving_grams: number | null }

/** A food: g (or ml), and its preset as a unit of its own. */
export function foodAmountModel(food: FoodLike): AmountModel {
  const base = food.unit?.trim().toLowerCase() === 'ml' ? 'ml' : 'g'
  const units: AmountUnit[] = [{ id: base, label: base, perUnit: 1, kind: 'weight' }]
  const word = presetWord(food.serving_label)
  if (word && food.serving_grams != null && food.serving_grams > 0) {
    units.push({ id: 'preset', label: word, perUnit: food.serving_grams, kind: 'count', word })
  }
  return { base, units, start: base }
}

/** "1 scoop" → "scoop"; "2 slices (60 g)" → "slices (60 g)" is left as typed after the number. */
export function presetWord(label: string | null | undefined): string | null {
  const t = label?.trim().replace(/^1\s+/, '')
  return t ? t : null
}

export interface RecipeLike {
  servings: number
  serving_label?: string | null
  batch_started_at?: string | null
  batch_servings?: number | null
  batch_cooked_g?: number | null
  ingredients: readonly { quantity: number | null; unit: string | null }[]
}

/** The raw weight of the recipe's base yield, or 0 when an ingredient can't be weighed ("2 eggs"). */
export function rawWeight(recipe: Pick<RecipeLike, 'ingredients'>): number {
  let sum = 0
  for (const i of recipe.ingredients) {
    if (i.quantity == null) continue          // to taste
    const g = toGrams(i.quantity, i.unit)
    if (g == null) return 0
    sum += g
  }
  return sum
}

/**
 * A recipe: its portion word, % of the batch (the current batch's servings,
 * else the recipe's), g raw when every ingredient weighs, g cooked while the
 * current batch's pot is weighed.
 */
export function recipeAmountModel(recipe: RecipeLike, batch: BatchState | null): AmountModel {
  const word = portionWord(recipe.serving_label)
  const live = batch && !batch.expired ? batch : null
  const batchServings = live?.servings ?? Math.max(1, recipe.servings)
  const units: AmountUnit[] = [
    { id: 'portion', label: word, perUnit: 1, kind: 'count', word },
    { id: 'pct', label: '% of batch', perUnit: batchServings / 100, kind: 'percent' },
  ]
  const raw = rawWeight(recipe)
  if (raw > 0) units.push({ id: 'raw', label: 'g raw', perUnit: Math.max(1, recipe.servings) / raw, kind: 'weight' })
  if (live?.cookedG) units.push({ id: 'cooked', label: 'g cooked', perUnit: live.servings / live.cookedG, kind: 'weight' })
  return { base: 'serving', units, start: 'portion', portionWord: word, batchServings }
}

export const unitOf = (m: AmountModel, id: AmountUnitId): AmountUnit => m.units.find(u => u.id === id) ?? m.units[0]
export const toUnit = (u: AmountUnit, base: number): number => base / u.perUnit
export const fromUnit = (u: AmountUnit, v: number): number => v * u.perUnit

/** One step of − / +: a count by one (½ at or under 1), grams by 10, % by 5 — landing on a round value. */
export function stepValue(u: AmountUnit, v: number, dir: 1 | -1): number {
  if (u.kind === 'count') {
    if (dir > 0) return v < 1 - 1e-9 ? (v < 0.5 - 1e-9 ? 0.5 : 1) : Math.floor(v + 1e-9) + 1
    if (v <= 1 + 1e-9) return 0.5
    return Math.ceil(v - 1e-9) - 1
  }
  const step = u.kind === 'percent' ? 5 : 10
  const next = dir > 0 ? Math.floor(v / step + 1e-9) * step + step : Math.ceil(v / step - 1e-9) * step - step
  return Math.max(step, next)
}

/**
 * The preset chips for a unit (base values), then "last time" when known and
 * different: a food's ½ / 1 portion (or 100 g), a count's ½–2 or 1–4, a
 * batch's 25–100 %, a weight's one and two portions in grams, and "The rest"
 * of an active batch.
 */
export function amountChips(m: AmountModel, unitId: AmountUnitId, opts: { last?: number | null; batch?: BatchState | null } = {}): AmountChip[] {
  const u = unitOf(m, unitId)
  const out: AmountChip[] = []
  const preset = m.units.find(x => x.id === 'preset')
  if (m.base !== 'serving') {
    if (u.id === 'preset' && preset) {
      for (const n of [0.5, 1, 1.5, 2]) out.push({ label: countLabel(n, preset.word!), base: n * preset.perUnit })
    } else if (preset) {
      out.push({ label: countLabel(0.5, preset.word!), base: preset.perUnit / 2 })
      out.push({ label: countLabel(1, preset.word!), hint: `${amountText(preset.perUnit)} ${m.base}`, base: preset.perUnit })
    } else {
      out.push({ label: `100 ${m.base}`, base: 100 })
    }
  } else {
    const word = m.portionWord ?? 'portion'
    const live = opts.batch && opts.batch.active ? opts.batch : null
    if (u.id === 'pct') {
      for (const p of [25, 50, 75, 100]) out.push({ label: `${p}%`, base: (p / 100) * (m.batchServings ?? 1) })
    } else if (u.id === 'raw' || u.id === 'cooked') {
      for (const n of [1, 2]) out.push({ label: countLabel(n, word), hint: `${Math.round(n / u.perUnit)} g`, base: n })
    } else {
      const counts = (m.batchServings ?? 1) <= 2 ? [0.5, 1, 1.5, 2] : [1, 2, 3, 4]
      for (const n of counts) out.push({ label: countLabel(n, word), base: n })
    }
    if (live && live.left > 0 && !out.some(c => Math.abs(c.base - live.left) < 1e-6)) {
      out.push({ label: 'The rest', hint: countLabel(live.left, word), base: live.left })
    }
  }
  const last = opts.last
  if (last != null && last > 0 && !out.some(c => Math.abs(c.base - last) < 1e-6)) {
    out.push({ label: `${unitText(u, last, m)} last time`, base: last })
  }
  return out
}

/** A base amount said in a unit: "150 g", "3 pieces", "25%", "180 g raw". */
export function unitText(u: AmountUnit, base: number, m?: AmountModel): string {
  const v = toUnit(u, base)
  if (u.kind === 'count') return countLabel(v, u.word ?? m?.portionWord ?? 'portion')
  if (u.kind === 'percent') return `${Math.round(v)}%`
  return `${Math.round(v)} ${u.label}`
}

/**
 * The "= …" beside the field: the same amount in the thing's other main unit
 * (grams ↔ the preset; a recipe's pieces ↔ % of the batch), or null.
 */
export function amountHint(m: AmountModel, unitId: AmountUnitId, base: number): string | null {
  if (!(base > 0)) return null
  const u = unitOf(m, unitId)
  if (m.base !== 'serving') {
    const preset = m.units.find(x => x.id === 'preset')
    if (!preset) return null
    return u.id === 'preset' ? `= ${amountText(base)} ${m.base}` : `= ${unitText(preset, base)}`
  }
  const portion = unitOf(m, 'portion')
  if (u.id === 'portion') return (m.batchServings ?? 1) > 1 ? `= ${Math.round((base / (m.batchServings ?? 1)) * 100)}% of batch` : null
  return `= ${unitText(portion, base, m)}`
}

// ── Batches (8.3) ───────────────────────────────────────────────────────────

/** A batch is being eaten for this many days after it was made. */
export const BATCH_DAYS = 4

export interface BatchRow { id: string; recipe_id: string | null; date: string; created_at: string; quantity: number | null; status?: string | null }

export interface BatchState {
  startedAt: string
  /** The local day it was made (YYYY-MM-DD). */
  startDay: string
  servings: number
  cookedG: number | null
  /** Servings of it eaten since it started (the row being edited left out). */
  eaten: number
  /** servings − eaten (0 or less: eaten up). */
  left: number
  expired: boolean
  /** Not expired and something left: the sheet shows it. */
  active: boolean
}

const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** The recipe's current batch from the diary rows of it, or null when none was ever started. */
export function batchState(recipe: RecipeLike & { id?: string }, rows: readonly BatchRow[], now: Date, excludeId?: string): BatchState | null {
  if (!recipe.batch_started_at) return null
  const start = new Date(recipe.batch_started_at)
  if (Number.isNaN(start.getTime())) return null
  const startDay = localDay(start)
  const servings = recipe.batch_servings && recipe.batch_servings > 0 ? recipe.batch_servings : Math.max(1, recipe.servings)
  let eaten = 0
  for (const r of rows) {
    if (r.id === excludeId || (recipe.id && r.recipe_id !== recipe.id)) continue
    if (r.status && r.status !== 'eaten') continue
    if (r.date < startDay || new Date(r.created_at).getTime() < start.getTime()) continue
    eaten += Number(r.quantity) || 0
  }
  eaten = Math.round(eaten * 100) / 100
  const left = Math.round((servings - eaten) * 100) / 100
  const expired = now.getTime() - start.getTime() >= BATCH_DAYS * 86_400_000
  return { startedAt: recipe.batch_started_at, startDay, servings, cookedG: recipe.batch_cooked_g && recipe.batch_cooked_g > 0 ? recipe.batch_cooked_g : null, eaten, left, expired, active: !expired && left > 0 }
}

/**
 * What a saved meal's tile says about its batch: "13 pieces left" while one
 * is on, "none left" (greyed) once it is eaten up or over; nothing for a
 * recipe that never had a batch.
 */
export function batchNote(b: BatchState | null | undefined, word: string): { text: string; gone: boolean } | null {
  if (!b) return null
  return b.active ? { text: `${countLabel(b.left, word)} left`, gone: false } : { text: 'none left', gone: true }
}

/** The earliest local day of the batches still within BATCH_DAYS (what one diary read must cover), or null. */
export function liveBatchesFrom(recipes: readonly Pick<RecipeLike, 'batch_started_at'>[], now: Date): string | null {
  let from: string | null = null
  for (const r of recipes) {
    if (!r.batch_started_at) continue
    const start = new Date(r.batch_started_at)
    if (Number.isNaN(start.getTime()) || now.getTime() - start.getTime() >= BATCH_DAYS * 86_400_000) continue
    const day = localDay(start)
    if (!from || day < from) from = day
  }
  return from
}

export interface BatchBar { eaten: number; this: number; left: number; over: number; total: number }

/** The bar [eaten | this | left | over], in servings; `over` is what this takes beyond what was left. */
export function batchBar(b: Pick<BatchState, 'servings' | 'eaten'>, thisServings: number): BatchBar {
  const eaten = Math.min(Math.max(0, b.eaten), b.servings)
  const room = b.servings - eaten
  const t = Math.max(0, thisServings)
  const inside = Math.min(t, room)
  const over = Math.round((t - inside) * 100) / 100
  const left = Math.round((room - inside) * 100) / 100
  return { eaten, this: inside, left, over, total: eaten + inside + left + over }
}
