import { useState } from 'react'
import { useRecipes } from '../hooks/useRecipes'
import { RecipeCard } from '../components/RecipeCard'
import { RecipeModal } from '../components/RecipeModal'
import { RecipeDetail } from '../components/RecipeDetail'
import { MealPlanWeek } from '../components/MealPlanWeek'
import type { RecipeWithIngredients } from '../types'

type Tab = 'library' | 'plan'

export function RecipesPage() {
  const { data: recipes = [], isLoading } = useRecipes()
  const [tab,       setTab]       = useState<Tab>('library')
  const [addOpen,   setAddOpen]   = useState(false)
  const [detail,    setDetail]    = useState<RecipeWithIngredients | null>(null)
  const [editing,   setEditing]   = useState<RecipeWithIngredients | null>(null)

  // Keep the open detail/edit view in sync with refreshed query data.
  const liveDetail  = detail  ? recipes.find(r => r.id === detail.id)  ?? null : null
  const liveEditing = editing ? recipes.find(r => r.id === editing.id) ?? editing : null

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-ink-900">Recipes</h1>
          <p className="text-xs text-ink-400 mt-0.5">Your recipes — scale servings, track macros</p>
        </div>
        {tab === 'library' && (
          <button
            onClick={() => setAddOpen(true)}
            className="min-h-[44px] px-4 bg-accent-500 text-white text-sm font-semibold rounded-xl hover:bg-accent-600 transition-colors"
          >
            + Add recipe
          </button>
        )}
      </div>

      {/* Tab toggle */}
      <div className="flex gap-1 mb-5 bg-white border border-ink-200 p-1 rounded-xl w-fit">
        {(['library', 'plan'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 min-h-[40px] text-sm font-medium rounded-lg transition-colors duration-150 ${
              tab === t ? 'bg-accent-500 text-white' : 'text-ink-500 hover:text-ink-900 hover:bg-ink-100'
            }`}
          >
            {t === 'library' ? 'Library' : 'Meal Plan'}
          </button>
        ))}
      </div>

      {tab === 'plan' && <MealPlanWeek />}

      {tab === 'library' && (
        <>
          {isLoading && <p className="text-sm text-ink-400">Loading…</p>}

          {!isLoading && recipes.length === 0 && (
            <div className="text-center py-14 border border-dashed border-ink-200 rounded-xl">
              <p className="text-2xl mb-2">🍳</p>
              <p className="text-ink-600 font-medium text-sm">No recipes yet</p>
              <p className="text-ink-400 text-xs mt-1">Add your first recipe to start planning meals</p>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {recipes.map(r => (
              <RecipeCard key={r.id} recipe={r} onClick={() => setDetail(r)} />
            ))}
          </div>
        </>
      )}

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
