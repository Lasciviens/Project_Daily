// Food · Today's "Quick guess" card: log something you can't weigh — a few
// sweets, a soft drink, a beer — as a one-off diary line (custom title +
// kcal + protein/carbs/fat), like Quick add in the logger. The presets are the
// owner's own rows (quick_guess_items, migration 152; edited in Settings →
// Food), with the built-in DEFAULT_GUESSES as their seed and as the fallback
// while 152 isn't applied. A portion factor scales every macro, and your own
// recent guesses are derived from past one-off diary lines (no table of their
// own). Pure and import-free; verified by scripts/verify-quick-guess.cjs.

export interface GuessMacros { kcal: number; protein: number; carbs: number; fat: number; sugar: number }

export interface GuessPreset extends GuessMacros {
  key: string
  /** What goes into the diary line. */
  title: string
  /** Content emoji for the chip ('' = picked from the title). */
  icon: string
  /** What "one" means, for the chip's tooltip ('' = not given). */
  portion: string
}

// Typical values per portion (Matvaretabellen / product labels, rounded).
// Alcohol's own calories are in kcal but in no macro, so a beer's
// 4P + 4C + 9F stays well under its kcal — that is correct, not a typo.
// Migration 152 seeds these as rows (same values; verify-quick-guess compares).
export const DEFAULT_GUESSES: readonly GuessPreset[] = [
  { key: 'protein', title: 'Protein', icon: '💪', portion: 'a protein pudding, a skyr or half a bar', kcal: 110, protein: 10, carbs: 10, fat: 3, sugar: 6 },
  { key: 'sweet', title: 'Sweet', icon: '🍬', portion: 'a handful (about 50 g)', kcal: 220, protein: 2, carbs: 38, fat: 7, sugar: 30 },
  { key: 'soda', title: 'Soft drink', icon: '🥤', portion: '0.5 L, not sugar-free', kcal: 210, protein: 0, carbs: 53, fat: 0, sugar: 53 },
  { key: 'juice', title: 'Juice', icon: '🧃', portion: 'a glass (250 ml)', kcal: 115, protein: 2, carbs: 26, fat: 0, sugar: 22 },
  { key: 'beer', title: 'Beer', icon: '🍺', portion: '0.5 L, 4.7 %', kcal: 215, protein: 2, carbs: 18, fat: 0, sugar: 0 },
  { key: 'wine', title: 'Wine', icon: '🍷', portion: 'a glass (150 ml)', kcal: 125, protein: 0, carbs: 4, fat: 0, sugar: 1 },
  { key: 'latte', title: 'Latte', icon: '☕', portion: 'a coffee with milk (about 300 ml)', kcal: 130, protein: 8, carbs: 12, fat: 5, sugar: 12 },
  { key: 'small', title: 'Small snack', icon: '🥨', portion: 'a biscuit, a bun or a few crisps', kcal: 150, protein: 4, carbs: 18, fat: 7, sugar: 6 },
  { key: 'big', title: 'Big snack', icon: '🍔', portion: 'a pastry, a hot dog or a chocolate bar and a drink', kcal: 400, protein: 15, carbs: 42, fat: 18, sugar: 15 },
]

/** The built-in names before migration 152 renamed them: lines logged under them are still presets, not "your recent guesses". */
export const LEGACY_GUESS_TITLES: readonly string[] = ['Protein snack', 'Candy']

// ── The owner's presets (quick_guess_items, migration 152) ─────────────────

/** A quick_guess_items row (per portion; the food tables' column names). */
export interface QuickGuessItem {
  id: string
  name: string
  icon: string | null
  portion: string | null
  calories: number
  protein_g: number
  carbs_g: number
  fat_g: number
  sugar_g: number
  sort_order: number
}

export type QuickGuessInput = Omit<QuickGuessItem, 'id'>

export function itemToPreset(i: QuickGuessItem): GuessPreset {
  return {
    key: i.id, title: i.name, icon: i.icon ?? '', portion: i.portion ?? '',
    kcal: i.calories, protein: i.protein_g, carbs: i.carbs_g, fat: i.fat_g, sugar: i.sugar_g,
  }
}

/** The editor's form: text as typed, numbers as parsed (null = empty). */
export interface GuessDraft {
  name: string
  icon: string
  portion: string
  kcal: number | null
  protein: number | null
  carbs: number | null
  fat: number | null
  sugar: number | null
}

export const EMPTY_DRAFT: GuessDraft = { name: '', icon: '', portion: '', kcal: null, protein: null, carbs: null, fat: null, sugar: null }

export function itemToDraft(i: QuickGuessItem): GuessDraft {
  return { name: i.name, icon: i.icon ?? '', portion: i.portion ?? '', kcal: i.calories, protein: i.protein_g, carbs: i.carbs_g, fat: i.fat_g, sugar: i.sugar_g }
}

// The table's own CHECKs (migration 152), said in words before a save.
const MACRO_MAX = { protein: 500, carbs: 1000, fat: 500, sugar: 1000 } as const
const MACRO_NAME = { protein: 'Protein', carbs: 'Carbs', fat: 'Fat', sugar: 'Sugar' } as const

/** Why the draft can't be saved, or null. */
export function draftProblem(d: GuessDraft): string | null {
  const name = d.name.trim()
  if (!name) return 'Give it a name'
  if (name.length > 60) return 'Keep the name to 60 characters'
  if ([...d.icon.trim()].length > 16) return 'The icon is one emoji'
  if (d.portion.trim().length > 120) return 'Keep the portion to 120 characters'
  if (d.kcal == null || !(d.kcal > 0)) return 'Calories must be more than 0'
  if (d.kcal > 5000) return 'At most 5000 kcal a portion'
  for (const k of ['protein', 'carbs', 'fat', 'sugar'] as const) {
    const v = d[k]
    if (v != null && v < 0) return `${MACRO_NAME[k]} can't be below 0`
    if (v != null && v > MACRO_MAX[k]) return `${MACRO_NAME[k]} is at most ${MACRO_MAX[k]} g`
  }
  return null
}

/** The row to write: trimmed text, empty text as null, empty macros as 0. */
export function draftToInput(d: GuessDraft, sortOrder: number): QuickGuessInput {
  const text = (s: string) => (s.trim() === '' ? null : s.trim())
  return {
    name: d.name.trim(), icon: text(d.icon), portion: text(d.portion),
    calories: d.kcal ?? 0, protein_g: d.protein ?? 0, carbs_g: d.carbs ?? 0, fat_g: d.fat ?? 0, sugar_g: d.sugar ?? 0,
    sort_order: sortOrder,
  }
}

/** Where a new preset goes: after the last one. */
export function nextSortOrder(items: readonly Pick<QuickGuessItem, 'sort_order'>[]): number {
  return items.reduce((m, i) => Math.max(m, i.sort_order + 1), 0)
}

/**
 * Moving one preset up (-1) or down (+1): the list is numbered 0, 1, 2… in
 * its current order with the two swapped, and only the rows whose number
 * changes are returned (two, or more when older rows shared a number).
 * Nothing at either end.
 */
export function moveGuess(items: readonly Pick<QuickGuessItem, 'id' | 'sort_order'>[], id: string, dir: -1 | 1): { id: string; sort_order: number }[] {
  const order = [...items].sort((a, b) => a.sort_order - b.sort_order)
  const from = order.findIndex(i => i.id === id)
  const to = from + dir
  if (from < 0 || to < 0 || to >= order.length) return []
  ;[order[from], order[to]] = [order[to], order[from]]
  return order.flatMap((item, i) => (item.sort_order === i ? [] : [{ id: item.id, sort_order: i }]))
}

/** Portion factors offered by the size switch; 1 is the default. */
export const GUESS_FACTORS = [0.5, 1, 1.5, 2] as const
export type GuessFactor = typeof GUESS_FACTORS[number]

const FACTOR_LABEL: Record<number, string> = { 0.5: '½', 1: '1', 1.5: '1½', 2: '2', 3: '3' }
/** "½", "1½", "2" — the factor as it is written in a title and on the switch. */
export function factorLabel(f: number): string {
  return FACTOR_LABEL[f] ?? String(f)
}

/** Every macro times the factor (a scaled kcal to the nearest 5, grams to the nearest 1). */
export function scaleGuess<T extends GuessMacros>(g: T, factor: number): GuessMacros {
  return {
    kcal: factor === 1 ? Math.round(g.kcal) : Math.round((g.kcal * factor) / 5) * 5,
    protein: Math.round(g.protein * factor),
    carbs: Math.round(g.carbs * factor),
    fat: Math.round(g.fat * factor),
    sugar: Math.round(g.sugar * factor),
  }
}

/** The diary title: "Beer", "Beer ×2", "Candy ×½". */
export function guessTitle(title: string, factor: number): string {
  return factor === 1 ? title : `${title} ×${factorLabel(factor)}`
}

/** Reads a title written by guessTitle back: "Beer ×2" → Beer, 2. Any other title → itself, 1. */
export function parseGuessTitle(title: string): { base: string; factor: number } {
  const m = title.trim().match(/^(.*\S)\s+×(½|1½|\d+(?:[.,]\d+)?)$/)
  if (!m) return { base: title.trim(), factor: 1 }
  const raw = m[2]
  const factor = raw === '½' ? 0.5 : raw === '1½' ? 1.5 : Number(raw.replace(',', '.'))
  return factor > 0 ? { base: m[1], factor } : { base: title.trim(), factor: 1 }
}

/** A past diary line as the recents query returns it (fetchRecentFoods). */
export interface PastLine {
  key: string
  title: string
  library_ingredient_id: string | null
  recipe_id: string | null
  calories: number | null
  protein_g: number | null
  carbs_g: number | null
  fat_g: number | null
  sugar_g?: number | null
  count: number
}

export interface RecentGuess extends GuessMacros { key: string; title: string; count: number }

const fold = (s: string) => s.trim().toLowerCase()

/**
 * Your own guesses: past one-off lines (no food, no recipe) with calories,
 * read back to one portion ("Kebab ×2" at 1,400 kcal is a 700 kcal Kebab),
 * the same title merged, your presets left out (they have their chip) and so
 * are the built-in names before 152 ("Candy"), most logged first.
 */
export function recentGuesses(lines: readonly PastLine[], presetTitles: readonly string[], limit = 4): RecentGuess[] {
  const presets = new Set([...presetTitles, ...LEGACY_GUESS_TITLES].map(fold))
  const byTitle = new Map<string, RecentGuess>()
  for (const l of lines) {
    if (l.library_ingredient_id || l.recipe_id) continue
    if (!(l.calories != null && l.calories > 0)) continue
    const { base, factor } = parseGuessTitle(l.title)
    const k = fold(base)
    if (!k || presets.has(k)) continue
    const seen = byTitle.get(k)
    if (seen) { seen.count += l.count; continue }
    byTitle.set(k, {
      key: `c:${k}`, title: base, count: l.count,
      kcal: Math.round(l.calories / factor),
      protein: Math.round((l.protein_g ?? 0) / factor),
      carbs: Math.round((l.carbs_g ?? 0) / factor),
      fat: Math.round((l.fat_g ?? 0) / factor),
      sugar: Math.round((l.sugar_g ?? 0) / factor),
    })
  }
  return [...byTitle.values()].sort((a, b) => b.count - a.count).slice(0, limit)
}
