import { hasMacros, isHighProteinFood, proteinDensity, type FoodHit, type Usage } from '../foodLibraryModel'
import { LibraryCard } from './LibraryCard'

/**
 * A library food in the Library search: what its portion (preset, else 100 g)
 * gives you; + logs that portion, the card opens the logger to pick an amount.
 */
export function LibraryFoodCard({ hit, usage, onOpen, onLog, logLabel }: {
  hit: FoodHit
  usage?: Usage
  onOpen: () => void
  onLog: () => void
  logLabel: string
}) {
  const f = hit.food
  const k = hit.grams / 100
  const macros = hasMacros(f) ? {
    kcal: hit.kcal, protein: hit.protein,
    carbs: f.carbs_g == null ? null : f.carbs_g * k, fat: f.fat_g == null ? null : f.fat_g * k,
    density: proteinDensity(f.calories, f.protein_g), high: isHighProteinFood(f),
  } : null
  return (
    <LibraryCard title={f.name} imageUrl={f.image_url} group={f.food_group} macros={macros} usage={usage}
      meta={[hit.portion]}
      onOpen={onOpen} onLog={onLog} logLabel={logLabel} />
  )
}
