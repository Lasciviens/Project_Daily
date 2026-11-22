// What the recipe editor takes from the `claude` function's recipe jobs, read again where it enters the browser
// (the function checked it too: supabase/claude-src/recipe-rules.ts; a second check costs nothing, and the answer
// crosses the network). A value that fails is dropped, never repaired. Pure: scripts/verify-ai-ledger-ui.cjs runs it.

export interface ParsedRecipeIngredient {
  name: string
  quantity: number | null
  unit: string | null
  note: string | null
}

export interface MacroEstimate {
  calories: number | null
  protein_g: number | null
  carbs_g: number | null
  fat_g: number | null
  sugar_g: number | null
}

export interface ParsedRecipe {
  title: string
  servings: number
  instructions: string | null
  ingredients: ParsedRecipeIngredient[]
  macro_estimate: MacroEstimate | null
  /** false: the recipe was read from the page's own data, no AI was used. */
  usedAi: boolean
}

/** The longest pasted recipe the function reads (its request is small): longer text is turned back here, with a sentence. */
export const RECIPE_TEXT_MAX = 6000

const NUTRITION_MAX = { calories: 5000, protein_g: 500, carbs_g: 1000, fat_g: 500, sugar_g: 1000 } as const
const KEYS = ['calories', 'protein_g', 'carbs_g', 'fat_g', 'sugar_g'] as const

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const line = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null
  const t = v.replace(/\s+/g, ' ').trim()
  return t && t.length <= max ? t : null
}
const num = (v: unknown, min: number, max: number): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null)

/** One value of each kind from a per-serving object; a bad one is null. */
function macros(raw: unknown): MacroEstimate | null {
  if (!isObj(raw)) return null
  const out = {} as MacroEstimate
  for (const key of KEYS) {
    const n = num(raw[key], 0, NUTRITION_MAX[key])
    out[key] = n === null ? null : Math.round(n)
  }
  return KEYS.some(k => out[k] !== null) ? out : null
}

/** The recipe a recipe job answered, or null when it has no title or no ingredient. */
export function readParsedRecipe(raw: unknown): ParsedRecipe | null {
  if (!isObj(raw)) return null
  const title = line(raw.title, 150)
  if (!title || !Array.isArray(raw.ingredients)) return null
  const ingredients: ParsedRecipeIngredient[] = []
  for (const item of raw.ingredients.slice(0, 80)) {
    if (!isObj(item)) continue
    const name = line(item.name, 160)
    if (!name) continue
    const quantity = num(item.quantity, 0, 100_000)
    ingredients.push({ name, quantity: quantity !== null && quantity > 0 ? quantity : null, unit: line(item.unit, 24), note: line(item.note, 200) })
  }
  if (!ingredients.length) return null
  const servings = num(raw.servings, 1, 100)
  const instructions = typeof raw.instructions === 'string' ? raw.instructions.split('\n').map(l => line(l, 1500)).filter(Boolean).slice(0, 80).join('\n') : ''
  return {
    title,
    servings: servings === null ? 1 : Math.round(servings),
    instructions: instructions || null,
    ingredients,
    macro_estimate: macros(raw.macro_estimate),
    usedAi: raw.usedAi !== false,
  }
}

/** The five per-serving values of the macros job, all of them whole and in range, or null. */
export function readMacroEstimate(raw: unknown): MacroEstimate | null {
  const read = macros(raw)
  return read && KEYS.every(k => read[k] !== null) ? read : null
}
