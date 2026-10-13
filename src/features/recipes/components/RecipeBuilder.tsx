import { useMemo, useRef, useState } from 'react'
import { ListPlus, Plus } from 'lucide-react'
import { toast } from '../../../app/store'
import { ModalShell } from '../../../shared/modals/ModalShell'
import { Button, cx } from '../../../shared/ui'
import { useIngredientLibrary } from '../hooks/useIngredientLibrary'
import { useAddFoodFavorite, useFoodFavorites, useRecentFoods, useRemoveFoodFavorite } from '../hooks/useFoodLog'
import { useCreateRecipe } from '../hooks/useRecipes'
import { parseQuickAdd, rankMatches } from '../foodSearch'
import {
  basketToIngredients, basketTotals, lastGrams, perPortion, wholePortions, type BasketItem,
} from '../foodBasket'
import { proteinDensity } from '../foodLibraryModel'
import { BasketRow, FoodMatchRow, FoodTile } from './foodLogKit'
import { sanitizeDecimal } from './foodLogUtils'
import { FoodSearchField } from './FoodSearchField'
import { NewFoodForm, type NewFoodSeed } from './NewFoodForm'
import type { FoodCategory, IngredientDraft, IngredientLibraryItem } from '../types'

/** What the builder hands to the full recipe form ("All fields"). */
export interface RecipeDraft {
  title: string
  servings: number
  category: FoodCategory | ''
  ingredients: IngredientDraft[]
}

const CATEGORIES: FoodCategory[] = ['breakfast', 'lunch', 'dinner', 'snack', 'supplement']
const TILE_LIMIT = 12

/**
 * The fast way to make a recipe (owner, 13.10.2026: "creating a meal is tons
 * of work in Library"): the logger's basket — search your foods (or scan /
 * search online), tap to add, type grams, watch kcal / protein / carbs / fat
 * per portion, save. Every row is library-linked by weight, so the recipe is
 * 'from_ingredients' and its macros follow its foods. Instructions, a photo
 * or AI paste live in the full form ("All fields").
 */
export function RecipeBuilder({ onClose, onMoreFields }: {
  onClose: () => void
  onMoreFields: (draft: RecipeDraft) => void
}) {
  const { data: library = [] } = useIngredientLibrary()
  const { data: recents = [] } = useRecentFoods()
  const { data: favorites = [] } = useFoodFavorites()
  const addFavorite = useAddFoodFavorite()
  const removeFavorite = useRemoveFoodFavorite()
  const create = useCreateRecipe()

  const [name, setName] = useState('')
  const [category, setCategory] = useState<FoodCategory | ''>('')
  const [portionsText, setPortionsText] = useState('1')
  const [basket, setBasket] = useState<BasketItem[]>([])
  const [query, setQuery] = useState('')
  const [newFood, setNewFood] = useState<NewFoodSeed | null>(null)
  const [newFoodKey, setNewFoodKey] = useState(0)
  const nameRef = useRef<HTMLInputElement>(null)

  const portions = wholePortions(portionsText)
  const quick = useMemo(() => parseQuickAdd(query), [query])
  const matches = useMemo(() => rankMatches(library, quick.title, i => i.name, 20), [library, quick.title])
  const searching = quick.title.trim() !== ''

  // Your foods to tap in: favourites first, then recently eaten — library foods only.
  const tiles = useMemo(() => {
    const byId = new Map(library.map(l => [l.id, l]))
    const favKeys = new Set(favorites.map(f => f.key))
    const seen = new Set<string>()
    return [...favorites, ...recents]
      .filter(r => r.library_ingredient_id && byId.has(r.library_ingredient_id) && !seen.has(r.key) && seen.add(r.key))
      .slice(0, TILE_LIMIT)
      .map(r => ({ r, food: byId.get(r.library_ingredient_id!)!, favorite: favKeys.has(r.key) }))
  }, [library, favorites, recents])

  const totals = basketTotals(basket)
  const each = perPortion(totals, portions)
  const density = proteinDensity(each.kcal, each.protein)

  function add(food: IngredientLibraryItem, grams?: number) {
    setBasket(b => [...b, { ingredient: food, grams: grams ?? food.serving_grams ?? 100 }])
    setQuery('')
  }
  function setGrams(idx: number, raw: string) {
    const n = Number(sanitizeDecimal(raw))
    setBasket(b => b.map((it, i) => (i === idx ? { ...it, grams: Number.isFinite(n) ? n : 0 } : it)))
  }
  const openNewFood = (seed: NewFoodSeed) => { setNewFood(seed); setNewFoodKey(k => k + 1) }

  const draft = (): RecipeDraft => ({ title: name.trim(), servings: portions, category, ingredients: basketToIngredients(basket) })

  async function handleSave() {
    if (basket.length === 0) return
    if (!name.trim()) { toast.warning('Give the recipe a name'); nameRef.current?.focus(); return }
    if (basket.some(it => !(it.grams > 0))) { toast.warning('Enter an amount for every item'); return }
    try {
      await create.mutateAsync({
        title: name.trim(), servings: portions, macro_mode: 'from_ingredients', is_temp: false,
        category: category || null, ingredients: basketToIngredients(basket),
      })
      onClose()
    } catch { return }   // the hook already toasted + logged
  }

  return (
    <ModalShell
      onClose={onClose}
      title="New recipe"
      size="lg"
      mobile="fullscreen"
      dismissible={!create.isPending}
      panelClassName="sm:!h-[min(780px,88dvh)]"
      bodyClassName="flex flex-col gap-3 px-4 pb-4"
      headerActions={
        <Button variant="ghost" size="sm" icon={<ListPlus />} onClick={() => onMoreFields(draft())}
          title="Instructions, photo, typed macros or paste a recipe with AI">
          All fields
        </Button>
      }
      footer={
        <div className="flex flex-col gap-2">
          {basket.length > 0 && (
            // At most 30 % of the height, so a sideways phone keeps room for the search results.
            <div className="-mx-4 -mt-3 max-h-[min(14rem,30dvh)] overflow-y-auto border-b border-line bg-surface-2 px-4 py-2 sm:-mx-5 sm:px-5">
              <div className="flex min-h-[32px] items-center justify-between gap-2">
                <p className="section-label shrink-0">Ingredients · {basket.length}</p>
                <label className="flex shrink-0 items-center gap-1.5 text-meta text-fg-muted" title="How many portions this batch makes — the Library shows one portion">
                  Makes
                  <input value={portionsText} onChange={e => setPortionsText(sanitizeDecimal(e.target.value).replace('.', ''))} inputMode="numeric"
                    aria-label="Portions this recipe makes" className="input h-8 min-h-0 w-12 px-1 text-center tabular-nums" />
                  {portions === 1 ? 'portion' : 'portions'}
                </label>
              </div>
              {basket.map((it, i) => (
                <BasketRow key={`${it.ingredient.id}-${i}`} item={it} showProtein onGrams={raw => setGrams(i, raw)}
                  onRemove={() => setBasket(b => b.filter((_, j) => j !== i))} />
              ))}
            </div>
          )}
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1 leading-tight">
              <p className="text-ui font-bold text-fg tabular-nums">
                {Math.round(each.kcal)} <span className="font-normal text-fg-muted">kcal</span>
                <span className="font-normal text-fg-faint"> · </span>
                {Math.round(each.protein)} <span className="font-normal text-fg-muted">g protein{portions > 1 ? ' a portion' : ''}</span>
              </p>
              {/* One line on a phone: protein per 100 kcal joins from `sm`. */}
              <p className="text-meta text-fg-muted tabular-nums">
                {basket.length > 0 ? <>
                  {Math.round(each.carbs)} g carbs · {Math.round(each.fat)} g fat
                  {density != null && <span className="max-sm:hidden"> · {density} g protein / 100 kcal</span>}
                </> : 'Add foods to see the macros'}
              </p>
            </div>
            <Button variant="primary" onClick={handleSave} loading={create.isPending} disabled={basket.length === 0} className="shrink-0">
              Save recipe
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex items-center gap-2 pt-3">
        <input ref={nameRef} value={name} onChange={e => setName(e.target.value)} placeholder="Recipe name" aria-label="Recipe name"
          autoFocus className="input min-w-0 flex-1" />
        <select value={category} onChange={e => setCategory(e.target.value as FoodCategory | '')} aria-label="Category"
          className={cx('select w-auto shrink-0 capitalize', !category && 'text-fg-muted')}>
          <option value="">Category</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <FoodSearchField query={query} onQuery={setQuery} library={library} stickyClassName="!pt-1"
        placeholder="Add a food — e.g. chicken 150g"
        onExisting={food => add(food)} onProduct={product => openNewFood({ name: product.name, product })} />

      {newFood && (
        <NewFoodForm key={newFoodKey} seed={newFood} submitLabel="Add to recipe" onCancel={() => setNewFood(null)}
          onCreated={created => { add(created); setNewFood(null) }} />
      )}

      {searching ? (
        <div className="flex flex-col">
          {matches.map(food => (
            <FoodMatchRow key={food.id} food={food} showProtein onAdd={() => add(food, quick.grams ?? undefined)} />
          ))}
          {matches.length === 0 && (
            <p className="px-1 py-2 text-meta text-fg-muted">Not in your foods yet — search online or scan it above, or save it here.</p>
          )}
          <button type="button" onClick={() => openNewFood({ name: quick.title })} className="row row-interactive min-h-[52px] px-1 text-left">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-dashed border-accent-500/50 text-accent-600"><Plus className="h-4 w-4" aria-hidden /></span>
            <span className="text-body text-accent-700">Save “{quick.title}” as an ingredient (per 100g)…</span>
          </button>
        </div>
      ) : tiles.length > 0 ? (
        <section>
          <p className="section-label mb-2">Your foods</p>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {tiles.map(({ r, food, favorite }) => (
              <FoodTile key={r.key} title={food.name} group={food.food_group} imageUrl={food.image_url}
                calories={r.calories} sizeClass="w-9 h-9 sm:w-11 sm:h-11"
                isFavorite={favorite} onAdd={() => add(food, lastGrams(r))}
                onToggleFavorite={() => (favorite ? removeFavorite.mutate(r.key) : addFavorite.mutate(r))} />
            ))}
          </div>
        </section>
      ) : (
        <p className="py-8 text-center text-body text-fg-muted">Search a food above, scan a barcode or search online.</p>
      )}
    </ModalShell>
  )
}
