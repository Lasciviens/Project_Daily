import { useState, useMemo } from 'react'
import { useRecipes } from '../hooks/useRecipes'
import { RecipeCard } from '../components/RecipeCard'
import { RecipeModal } from '../components/RecipeModal'
import { RecipeDetail } from '../components/RecipeDetail'
import { MealPlanWeek } from '../components/MealPlanWeek'
import { RecipeBackdrop } from '../components/RecipeBackdrop'
import { IngredientManager } from '../components/IngredientManager'
import { FoodLogModal } from '../components/FoodLogModal'
import { SupplementModal } from '../components/SupplementModal'
import { FoodTodayTab } from '../components/FoodTodayTab'
import type { RecipeWithIngredients, FoodCategory } from '../types'
import { PersonalTabs } from '../../personal/components/PersonalLayout'

type Tab = 'today' | 'library' | 'ingredients' | 'plan'

export function RecipesPage() {
  const { data: recipes = [], isLoading } = useRecipes()
  const [tab,       setTab]       = useState<Tab>('today')
  const [addOpen,   setAddOpen]   = useState(false)
  const [detail,    setDetail]    = useState<RecipeWithIngredients | null>(null)
  const [editing,   setEditing]   = useState<RecipeWithIngredients | null>(null)
  const [query,     setQuery]     = useState('')
  const [category,  setCategory]  = useState<FoodCategory | 'all'>('all')
  const [logOpen,   setLogOpen]   = useState(false)
  const [suppOpen,  setSuppOpen]  = useState(false)

  // Keep the open detail/edit view in sync with refreshed query data.
  const liveDetail  = detail  ? recipes.find(r => r.id === detail.id)  ?? null : null
  const liveEditing = editing ? recipes.find(r => r.id === editing.id) ?? editing : null

  const filteredRecipes = useMemo(() => {
    const q = query.trim().toLowerCase()
    let out = recipes
    if (category !== 'all') out = out.filter(r => r.category === category)
    if (!q) return out
    return out.filter(r =>
      r.title.toLowerCase().includes(q) ||
      (r.description ?? '').toLowerCase().includes(q) ||
      r.ingredients.some(i => i.name.toLowerCase().includes(q))
    )
  }, [recipes, query, category])

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6">
      {/* Header banner — rotating recipe-photo backdrop, Media/Training-style */}
      <div className="relative overflow-hidden rounded-2xl border border-ink-200 mb-5 w-full min-h-[92px]">
        <RecipeBackdrop recipes={recipes} />
        <div className="absolute inset-0 bg-gradient-to-r from-cream-50/90 via-cream-50/60 to-cream-50/10" aria-hidden />
        <div className="relative z-10 flex flex-col gap-3 px-4 py-4 sm:px-5">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <h1 className="text-xl font-bold text-ink-900">Food</h1>
              <p className="text-xs text-ink-500 mt-0.5">Your meals & ingredients — log, scale, track macros</p>
            </div>
            <div className="flex items-center gap-2 ml-auto flex-wrap justify-end">
              <button
                onClick={() => setLogOpen(true)}
                className="min-h-[44px] px-4 bg-accent-500 text-white text-sm font-semibold rounded-xl hover:bg-accent-600 transition-colors shadow-sm whitespace-nowrap"
              >
                🍽️ Log food
              </button>
              <button
                onClick={() => setSuppOpen(true)}
                title="Log a supplement (creatine, protein, pre-workout)"
                aria-label="Log a supplement"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center border border-ink-200 text-ink-600 bg-cream-50 text-lg rounded-xl hover:border-accent-300 hover:text-accent-700 transition-colors"
              >
                💊
              </button>
              {tab === 'library' && (
                <button
                  onClick={() => setAddOpen(true)}
                  className="min-h-[44px] px-4 border border-accent-300 text-accent-700 bg-cream-50 text-sm font-semibold rounded-xl hover:bg-accent-50 transition-colors whitespace-nowrap"
                >
                  + Add recipe
                </button>
              )}
              <PersonalTabs />
            </div>
          </div>
          {/* Sub-tabs live INSIDE the banner (user request) — glassy chip row
              over the backdrop. Single non-wrapping row; scrolls if too narrow. */}
          <div className="flex gap-1 bg-cream-50/70 border border-ink-200 p-1 rounded-xl w-fit max-w-full overflow-x-auto scrollbar-none backdrop-blur-sm">
            {(['today', 'library', 'ingredients', 'plan'] as Tab[]).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`shrink-0 whitespace-nowrap px-3 sm:px-4 min-h-[40px] text-sm font-medium rounded-lg transition-colors duration-150 ${
                  tab === t ? 'bg-accent-500 text-white' : 'text-ink-600 hover:text-ink-900 hover:bg-ink-100'
                }`}
              >
                {t === 'today' ? 'Today' : t === 'library' ? 'Library' : t === 'ingredients' ? 'Ingredients' : 'Meal Plan'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Library search (only where it applies) */}
      {tab === 'library' && recipes.length > 0 && (
        <div className="relative max-w-xs min-w-[180px] mb-4">
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search recipes or ingredients…"
            className="w-full min-h-[40px] bg-cream-50 border border-ink-200 rounded-xl pl-8 pr-3 text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-accent-400"
          />
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-300 text-sm">🔍</span>
        </div>
      )}

      {tab === 'library' && recipes.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-4">
          {(['all', 'breakfast', 'lunch', 'dinner', 'snack', 'supplement'] as const).map(c => (
            <button key={c} onClick={() => setCategory(c)}
              className={`text-xs px-3 min-h-[36px] rounded-full border font-medium capitalize transition-colors ${
                category === c ? 'bg-accent-500 text-white border-accent-500' : 'border-ink-200 text-ink-600 hover:border-accent-300'
              }`}>
              {c === 'all' ? 'All' : c}
            </button>
          ))}
        </div>
      )}

      {tab === 'today' && <FoodTodayTab />}
      {tab === 'ingredients' && <IngredientManager />}
      {tab === 'plan' && <MealPlanWeek />}

      {tab === 'library' && (
        <>
          {isLoading && (
            <div className="grid grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(10rem,12rem))] justify-start gap-2.5">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-36 rounded-xl bg-cream-200 animate-pulse" />
              ))}
            </div>
          )}

          {!isLoading && recipes.length === 0 && (
            <div className="text-center py-14 border border-dashed border-ink-200 rounded-xl">
              <p className="text-2xl mb-2">🍳</p>
              <p className="text-ink-600 font-medium text-sm">No recipes yet</p>
              <p className="text-ink-400 text-xs mt-1">Add your first recipe to start planning meals</p>
            </div>
          )}

          {!isLoading && recipes.length > 0 && filteredRecipes.length === 0 && (
            <p className="text-sm text-ink-400 py-10 text-center">No recipes match "{query}"</p>
          )}

          {/* Dense small cards — fixed-width auto-fill columns (width standard) */}
          <div className="grid grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(10rem,12rem))] justify-start gap-2.5">
            {filteredRecipes.map(r => (
              <RecipeCard key={r.id} recipe={r} onClick={() => setDetail(r)} />
            ))}
          </div>
        </>
      )}

      {/* Log food (today) */}
      <FoodLogModal open={logOpen} onClose={() => setLogOpen(false)} date={new Date().toISOString().slice(0, 10)} />

      {/* Log supplement (today) */}
      <SupplementModal open={suppOpen} onClose={() => setSuppOpen(false)} date={new Date().toISOString().slice(0, 10)} />

      {/* Create */}
      <RecipeModal open={addOpen} onClose={() => setAddOpen(false)} />

      {/* Detail (view + scale) */}
      {liveDetail && (
        <RecipeDetail
          recipe={liveDetail}
          onClose={() => setDetail(null)}
          onEdit={r => { setDetail(null); setEditing(r) }}
        />
      )}

      {/* Edit */}
      <RecipeModal open={!!editing} onClose={() => setEditing(null)} recipe={liveEditing ?? undefined} />
    </div>
  )
}
