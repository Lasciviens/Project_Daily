import { runClaudeJob } from './claudeApi'
import { RECIPE_TEXT_MAX, readMacroEstimate, readParsedRecipe, type MacroEstimate, type ParsedRecipe } from './recipeAnswers'

// The recipe editor's and Food's quick-guess AI calls, each one job of the `claude` function (Claude Haiku;
// docs/features/ai.md). They only fill a form: the owner looks at the fields and saves them herself. A stopped run
// throws a ClaudeJobError whose message is the function's own sentence (off, budget, busy, not set up, declined …).

export type { MacroEstimate, ParsedRecipe, ParsedRecipeIngredient } from './recipeAnswers'

/** Said when an answer came back but held nothing the editor can use. */
const NOT_A_RECIPE = "That didn't read as a recipe — check the text and try again"

/** "Paste recipe" with text: the fields of a recipe, from its text. */
export async function parseRecipeText(text: string): Promise<ParsedRecipe> {
  const pasted = text.trim()
  if (pasted.length > RECIPE_TEXT_MAX) throw new Error(`That recipe is longer than ${RECIPE_TEXT_MAX} characters — paste a shorter one`)
  const { result } = await runClaudeJob<unknown>('recipe_from_text', { text: pasted })
  const recipe = readParsedRecipe(result)
  if (!recipe) throw new Error(NOT_A_RECIPE)
  return recipe
}

/**
 * "Paste recipe" with a link: the fields of the recipe on that page. `usedAi` says whether a model was asked; a
 * page that carries its recipe as structured data is read by the function's code alone.
 */
export async function parseRecipeFromLink(url: string): Promise<ParsedRecipe> {
  const { result, source } = await runClaudeJob<unknown>('recipe_from_link', { url: url.trim() })
  const recipe = readParsedRecipe(result)
  if (!recipe) throw new Error(NOT_A_RECIPE)
  return source === 'page' ? { ...recipe, usedAi: false } : recipe
}

/** "Estimate": one serving's calories, protein, carbs, fat and sugar, from the ingredients. */
export async function estimateRecipeMacros(
  ingredients: { name: string; quantity: number | null; unit: string | null }[],
  servings: number,
): Promise<MacroEstimate> {
  const rows = ingredients
    .filter(i => i.name.trim())
    .slice(0, 80)
    .map(i => ({
      name: i.name.trim().slice(0, 160),
      ...(i.quantity != null && Number.isFinite(i.quantity) && i.quantity > 0 ? { quantity: i.quantity } : {}),
      ...(i.unit?.trim() ? { unit: i.unit.trim().slice(0, 24) } : {}),
    }))
  const { result } = await runClaudeJob<unknown>('recipe_macros', { servings: Math.max(1, Math.min(100, Math.round(servings) || 1)), ingredients: rows })
  const estimate = readMacroEstimate(result)
  if (!estimate) throw new Error("The AI didn't send an estimate — try again")
  return estimate
}

/** "Describe it" (Food → Quick guess): free text → the AI's estimate as one diary line. The caller checks it (readGuessEstimate). */
export async function describeGuess(text: string): Promise<unknown> {
  return (await runClaudeJob<unknown>('quick_guess', { text: text.trim().slice(0, 500) })).result
}

/** The preset a "Suggest options" call drafts for (one portion's values). */
export interface GuessOptionsBrief {
  name: string
  portion: string
  calories: number
  protein_g: number
  carbs_g: number
  fat_g: number
  sugar_g: number
}

/** "Suggest options" in Settings → Food: the AI drafts a preset's option groups. The caller checks them (parseGuessOptions). */
export async function suggestGuessOptions(p: GuessOptionsBrief): Promise<unknown> {
  const input = { ...p, name: p.name.trim().slice(0, 60), portion: p.portion.trim().slice(0, 120) }
  return (await runClaudeJob<unknown>('quick_guess_options', input)).result
}
