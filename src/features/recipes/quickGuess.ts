// Food · Today's "Quick guess" card: log something you can't weigh — a few
// sweets, a soft drink, a beer — as a one-off diary line (custom title +
// kcal + protein/carbs/fat), like Quick add in the logger. The presets are the
// owner's own rows (quick_guess_items, migration 152; edited in Settings →
// Food), with the built-in DEFAULT_GUESSES as their seed and as the fallback
// while 152 isn't applied. A portion factor scales every macro, and your own
// recent guesses are derived from past one-off diary lines (no table of their
// own). A preset may carry option groups (migration 159) that the card asks
// about before it logs; the AI's "Describe it" estimate and "Suggest options"
// draft are read here too (review-first: they only fill a form).
// Pure and import-free; verified by scripts/verify-quick-guess.cjs.

export interface GuessMacros { kcal: number; protein: number; carbs: number; fat: number; sugar: number }

export interface GuessPreset extends GuessMacros {
  key: string
  /** What goes into the diary line. */
  title: string
  /** Content emoji for the chip ('' = picked from the title). */
  icon: string
  /** What "one" means, for the chip's tooltip ('' = not given). */
  portion: string
  /** Option groups asked before logging (migration 159); none = one tap. */
  options?: readonly GuessOptionGroup[]
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
  /** Option groups (migration 159); [] before it or when there are none. */
  options: GuessOptionGroup[]
}

export type QuickGuessInput = Omit<QuickGuessItem, 'id'>

export function itemToPreset(i: QuickGuessItem): GuessPreset {
  return {
    key: i.id, title: i.name, icon: i.icon ?? '', portion: i.portion ?? '',
    kcal: i.calories, protein: i.protein_g, carbs: i.carbs_g, fat: i.fat_g, sugar: i.sugar_g,
    options: i.options,
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
  /** Option groups as typed (migration 159). */
  options: GroupDraft[]
}

export const EMPTY_DRAFT: GuessDraft = { name: '', icon: '', portion: '', kcal: null, protein: null, carbs: null, fat: null, sugar: null, options: [] }

export function itemToDraft(i: QuickGuessItem): GuessDraft {
  return {
    name: i.name, icon: i.icon ?? '', portion: i.portion ?? '', kcal: i.calories, protein: i.protein_g, carbs: i.carbs_g, fat: i.fat_g, sugar: i.sugar_g,
    options: i.options.map(groupToDraft),
  }
}

/**
 * A logged one-off line as a new preset's form ("Save as Quick guess"): the
 * title read back to one portion ("Beer ×2" at 430 kcal → Beer, 215 kcal).
 */
export function lineToDraft(l: { title: string; calories: number | null; protein_g?: number | null; carbs_g?: number | null; fat_g?: number | null; sugar_g?: number | null }): GuessDraft {
  const { base, factor } = parseGuessTitle(l.title)
  const per = (v: number | null | undefined) => (v == null ? null : Math.round(v / factor))
  return { ...EMPTY_DRAFT, name: base, kcal: per(l.calories), protein: per(l.protein_g), carbs: per(l.carbs_g), fat: per(l.fat_g), sugar: per(l.sugar_g) }
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
  return optionsProblem(d.options)
}

/** The row to write: trimmed text, empty text as null, empty macros as 0. */
export function draftToInput(d: GuessDraft, sortOrder: number): QuickGuessInput {
  const text = (s: string) => (s.trim() === '' ? null : s.trim())
  return {
    name: d.name.trim(), icon: text(d.icon), portion: text(d.portion),
    calories: d.kcal ?? 0, protein_g: d.protein ?? 0, carbs_g: d.carbs ?? 0, fat_g: d.fat ?? 0, sugar_g: d.sugar ?? 0,
    sort_order: sortOrder,
    options: d.options.map(draftToGroup),
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

// ── Options: asked before logging (migration 159) ──────────────────────────
// A preset may carry up to three option groups ("On it", "Extra", "Size").
// "one" picks one choice (or none) and "any" picks any number — each picked
// choice ADDS its macros to the portion; "size" picks one choice that
// MULTIPLIES the whole portion, adds included. The card's own ½–2 switch
// multiplies on top. The log is still one one-off line titled with what was
// picked: "Pizza (chicken, cheese) ×1½".

export type GuessPick = 'one' | 'any' | 'size'
export const GUESS_PICKS: readonly GuessPick[] = ['one', 'any', 'size']

/** A choice: what it adds per portion ("one"/"any"), or its factor ("size"; macros 0). */
export interface GuessChoice extends GuessMacros { name: string; factor: number }
export interface GuessOptionGroup { name: string; pick: GuessPick; choices: GuessChoice[] }

// Migration 159's quick_guess_options_ok() — the same limits (verify-quick-guess reads them there).
export const OPTION_LIMITS = { groups: 3, choices: 6, name: 30, factor: 10 } as const
const ADD_MAX = { kcal: 5000, protein: 500, carbs: 1000, fat: 500, sugar: 1000 } as const
const ZERO: GuessMacros = { kcal: 0, protein: 0, carbs: 0, fat: 0, sugar: 0 }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isPick = (v: unknown): v is GuessPick => typeof v === 'string' && (GUESS_PICKS as readonly string[]).includes(v)
const finite = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null)
const clamp = (v: unknown, max: number) => Math.min(max, Math.max(0, Math.round(finite(v) ?? 0)))
const cut = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max).trim() : '')

/**
 * Option groups as they arrive — from the database or from the AI: anything
 * that isn't a valid group or choice is left out, at most 3 groups of 6
 * choices, names cut to 30 characters, macros whole and within the table's
 * ranges.
 */
export function parseGuessOptions(raw: unknown): GuessOptionGroup[] {
  if (!Array.isArray(raw)) return []
  const groups: GuessOptionGroup[] = []
  for (const g of raw) {
    if (groups.length >= OPTION_LIMITS.groups) break
    if (!isObj(g) || !isPick(g.pick) || !Array.isArray(g.choices)) continue
    const name = cut(g.name, OPTION_LIMITS.name)
    if (!name) continue
    const pick = g.pick
    const choices: GuessChoice[] = []
    for (const c of g.choices) {
      if (choices.length >= OPTION_LIMITS.choices) break
      if (!isObj(c)) continue
      const cname = cut(c.name, OPTION_LIMITS.name)
      if (!cname) continue
      if (pick === 'size') {
        const f = finite(c.factor)
        if (f != null && f > 0 && f <= OPTION_LIMITS.factor) choices.push({ name: cname, factor: f, ...ZERO })
      } else {
        choices.push({
          name: cname, factor: 1,
          kcal: clamp(c.calories, ADD_MAX.kcal), protein: clamp(c.protein_g, ADD_MAX.protein), carbs: clamp(c.carbs_g, ADD_MAX.carbs),
          fat: clamp(c.fat_g, ADD_MAX.fat), sugar: clamp(c.sugar_g, ADD_MAX.sugar),
        })
      }
    }
    if (choices.length) groups.push({ name, pick, choices })
  }
  return groups
}

/** The jsonb to store (the column's own names: calories, protein_g, …; a size choice keeps only its factor). */
export function optionsToJson(groups: readonly GuessOptionGroup[]): unknown[] {
  return groups.map(g => ({
    name: g.name, pick: g.pick,
    choices: g.choices.map(c => (g.pick === 'size'
      ? { name: c.name, factor: c.factor }
      : { name: c.name, calories: c.kcal, protein_g: c.protein, carbs_g: c.carbs, fat_g: c.fat, sugar_g: c.sugar })),
  }))
}

/** Which choices are picked, per group (indexes). */
export type GuessPicks = readonly (readonly number[])[]

export function noPicks(groups: readonly GuessOptionGroup[]): GuessPicks {
  return groups.map(() => [])
}

/** A tap on a choice: "one" and "size" hold one (a second tap clears it), "any" toggles. */
export function togglePick(groups: readonly GuessOptionGroup[], picks: GuessPicks, gi: number, ci: number): GuessPicks {
  const g = groups[gi]
  if (!g || !g.choices[ci]) return picks
  return groups.map((_, i) => {
    const now = picks[i] ?? []
    if (i !== gi) return now
    if (g.pick === 'any') return now.includes(ci) ? now.filter(x => x !== ci) : [...now, ci].sort((a, b) => a - b)
    return now.includes(ci) ? [] : [ci]
  })
}

/** "Chicken" → "chicken", "Pepsi Max" → "pepsi max"; "BBQ sauce" and "iPhone" stay as written. */
function inTitle(name: string): string {
  return name.split(' ').map(w => (/^\p{Lu}[\p{Ll}\d'’-]*$/u.test(w) ? w.toLowerCase() : w)).join(' ')
}

/** How much the picked size and the ½–2 switch multiply the portion together. */
export function pickedFactor(groups: readonly GuessOptionGroup[], picks: GuessPicks, factor: number): number {
  return groups.reduce((m, g, gi) => (g.pick === 'size' ? (picks[gi] ?? []).reduce((x, ci) => x * (g.choices[ci]?.factor ?? 1), m) : m), factor)
}

/**
 * What the ask-first sheet logs: (the portion + every picked "one"/"any"
 * choice) × the picked size × the ½–2 switch, rounded like scaleGuess, and
 * the title with what was picked: "Pizza (large, chicken, cheese) ×1½".
 */
export function pickedGuess(
  preset: Pick<GuessPreset, 'title' | keyof GuessMacros> & { options?: readonly GuessOptionGroup[] },
  picks: GuessPicks,
  factor: number,
): GuessMacros & { title: string } {
  const groups = preset.options ?? []
  const sum: GuessMacros = { kcal: preset.kcal, protein: preset.protein, carbs: preset.carbs, fat: preset.fat, sugar: preset.sugar }
  const names: string[] = []
  groups.forEach((g, gi) => {
    for (const ci of picks[gi] ?? []) {
      const c = g.choices[ci]
      if (!c) continue
      names.push(inTitle(c.name))
      if (g.pick === 'size') continue
      sum.kcal += c.kcal; sum.protein += c.protein; sum.carbs += c.carbs; sum.fat += c.fat; sum.sugar += c.sugar
    }
  })
  const base = names.length ? `${preset.title} (${names.join(', ')})` : preset.title
  return { ...scaleGuess(sum, pickedFactor(groups, picks, factor)), title: guessTitle(base, factor) }
}

/** "×1½", "×0.75" — a size choice's factor as its chip shows it. */
export function factorText(f: number): string {
  return `×${FACTOR_LABEL[f] ?? String(Math.round(f * 100) / 100)}`
}

/** A choice chip's small text: a size's factor; what a choice adds at the current size — protein when it adds 5 g or more, else kcal. */
export function choiceHint(c: GuessChoice, pick: GuessPick, mult: number): string {
  if (pick === 'size') return factorText(c.factor)
  const protein = Math.round(c.protein * mult)
  if (protein >= 5) return `+${protein} g protein`
  const kcal = Math.round(c.kcal * mult)
  return kcal > 0 ? `+${kcal} kcal` : ''
}

// ── The editor's options form ──────────────────────────────────────────────

/** A choice as typed: numbers null when empty; factor only for a "size" group. */
export interface ChoiceDraft { name: string; kcal: number | null; protein: number | null; carbs: number | null; fat: number | null; sugar: number | null; factor: number | null }
export interface GroupDraft { name: string; pick: GuessPick; choices: ChoiceDraft[] }

export const EMPTY_CHOICE: ChoiceDraft = { name: '', kcal: null, protein: null, carbs: null, fat: null, sugar: null, factor: null }

export function groupToDraft(g: GuessOptionGroup): GroupDraft {
  return {
    name: g.name, pick: g.pick,
    choices: g.choices.map(c => (g.pick === 'size'
      ? { ...EMPTY_CHOICE, name: c.name, factor: c.factor }
      : { name: c.name, kcal: c.kcal, protein: c.protein, carbs: c.carbs, fat: c.fat, sugar: c.sugar, factor: null })),
  }
}

export function draftToGroup(d: GroupDraft): GuessOptionGroup {
  return {
    name: d.name.trim(), pick: d.pick,
    choices: d.choices.map(c => (d.pick === 'size'
      ? { name: c.name.trim(), factor: c.factor ?? 1, ...ZERO }
      : { name: c.name.trim(), factor: 1, kcal: c.kcal ?? 0, protein: c.protein ?? 0, carbs: c.carbs ?? 0, fat: c.fat ?? 0, sugar: c.sugar ?? 0 })),
  }
}

/** Why the options can't be saved, or null — migration 159's check in words. */
export function optionsProblem(groups: readonly GroupDraft[]): string | null {
  if (groups.length > OPTION_LIMITS.groups) return `At most ${OPTION_LIMITS.groups} option groups`
  for (const [gi, g] of groups.entries()) {
    const name = g.name.trim()
    if (!name) return `Give option group ${gi + 1} a name`
    if (name.length > OPTION_LIMITS.name) return `Keep option group ${gi + 1}'s name to ${OPTION_LIMITS.name} characters`
    if (!isPick(g.pick)) return `Choose how “${name}” is picked`
    if (g.choices.length === 0) return `“${name}” needs at least one choice`
    if (g.choices.length > OPTION_LIMITS.choices) return `“${name}” has at most ${OPTION_LIMITS.choices} choices`
    for (const [ci, c] of g.choices.entries()) {
      const cname = c.name.trim()
      if (!cname) return `Give choice ${ci + 1} in “${name}” a name`
      if (cname.length > OPTION_LIMITS.name) return `Keep choice ${ci + 1} in “${name}” to ${OPTION_LIMITS.name} characters`
      if (g.pick === 'size') {
        if (c.factor == null || !(c.factor > 0)) return `“${cname}” needs a size above 0 (1.5 = half as much again)`
        if (c.factor > OPTION_LIMITS.factor) return `“${cname}” is at most ×${OPTION_LIMITS.factor}`
        continue
      }
      if (c.kcal != null && c.kcal < 0) return `“${cname}” can't add less than 0 kcal`
      if (c.kcal != null && c.kcal > ADD_MAX.kcal) return `“${cname}” adds at most ${ADD_MAX.kcal} kcal`
      for (const k of ['protein', 'carbs', 'fat', 'sugar'] as const) {
        const v = c[k]
        if (v != null && v < 0) return `“${cname}”: ${MACRO_NAME[k].toLowerCase()} can't be below 0`
        if (v != null && v > ADD_MAX[k]) return `“${cname}”: ${MACRO_NAME[k].toLowerCase()} is at most ${ADD_MAX[k]} g`
      }
    }
  }
  return null
}

// ── AI answers (review-first: they fill a form, never log or save) ─────────

/** "Describe it": the AI's estimate of a described meal, as one diary line. */
export interface GuessEstimate extends GuessMacros { title: string; portion: string; assumptions: string[] }

/** The AI's answer checked where it enters: text cut, numbers whole and within the table's ranges, at most 4 assumptions. */
export function readGuessEstimate(raw: unknown): GuessEstimate | null {
  if (!isObj(raw)) return null
  const assumptions = (Array.isArray(raw.assumptions) ? raw.assumptions : [])
    .map(a => cut(a, 200)).filter(Boolean).slice(0, 4)
  return {
    title: cut(raw.title, 60), portion: cut(raw.portion, 120),
    kcal: clamp(raw.calories, ADD_MAX.kcal), protein: clamp(raw.protein_g, ADD_MAX.protein), carbs: clamp(raw.carbs_g, ADD_MAX.carbs),
    fat: clamp(raw.fat_g, ADD_MAX.fat), sugar: clamp(raw.sugar_g, ADD_MAX.sugar),
    assumptions,
  }
}

// ── The diary's "≈" ────────────────────────────────────────────────────────

/** Shown before a guessed line's kcal in the diary ("≈ 620 kcal"). */
export const GUESS_MARK = '≈'

/**
 * A guessed diary line: a one-off line (no library food, no recipe) with
 * calories — a quick guess, a Quick add, an AI estimate. The same lines
 * "your recent guesses" read; nothing is stored to say so. An unknown source
 * (null) is not a guess, nor a scheduled supplement's dose (160: its values
 * are the schedule's).
 */
export function isGuessLine(
  src: { library_ingredient_id?: string | null; recipe_id?: string | null; supplement_schedule_id?: string | null } | null | undefined,
  calories: number | null | undefined,
): boolean {
  return !!src && !src.library_ingredient_id && !src.recipe_id && !src.supplement_schedule_id && calories != null && calories > 0
}
