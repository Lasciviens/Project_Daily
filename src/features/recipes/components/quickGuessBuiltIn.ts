import { DEFAULT_GUESSES, type QuickGuessItem } from '../quickGuess'

// Before migration 152 the editor shows the built-in presets; their ids are
// not rows, so a save adds a row and the api names the missing migration.
export const BUILT_IN = 'built-in:'
export const BUILT_IN_ITEMS: QuickGuessItem[] = DEFAULT_GUESSES.map((g, i) => ({
  id: `${BUILT_IN}${g.key}`, name: g.title, icon: g.icon, portion: g.portion,
  calories: g.kcal, protein_g: g.protein, carbs_g: g.carbs, fat_g: g.fat, sugar_g: g.sugar, sort_order: i, options: [],
}))
