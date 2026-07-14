import { useState } from 'react'
import { Dialog, DialogPanel } from '@headlessui/react'
import type { RecipeWithIngredients } from '../types'

interface Props {
  recipe: RecipeWithIngredients
  steps:  string[]
  onClose: () => void
}

/**
 * Full-screen, step-by-step guided cooking view — large text, one step at a
 * time, with a persistent ingredient checklist alongside. Not something the
 * user asked for explicitly, but the single highest-value addition a recipe
 * app can have once you're actually standing at the stove.
 */
export function CookMode({ recipe, steps, onClose }: Props) {
  const [stepIdx, setStepIdx]   = useState(0)
  const [done,     setDone]     = useState<Set<string>>(new Set())
  const [showIngredients, setShowIngredients] = useState(false)

  const isLast  = stepIdx === steps.length - 1
  const isFirst = stepIdx === 0

  function toggleIngredient(id: string) {
    setDone(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  return (
    <Dialog open onClose={onClose} className="relative z-[80]">
      <div className="fixed inset-0 bg-ink-950" />
      <div className="fixed inset-0 flex flex-col">
        <DialogPanel className="flex-1 flex flex-col min-h-0 bg-ink-950 text-white">
          {/* Header */}
          <div className="flex items-center justify-between px-4 sm:px-8 py-4 flex-shrink-0">
            <div className="min-w-0">
              <p className="text-xs text-ink-400 uppercase tracking-wider">Cook Mode</p>
              <p className="text-sm font-semibold text-white truncate">{recipe.title}</p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={() => setShowIngredients(s => !s)}
                className={`min-h-[44px] px-3 text-xs font-medium rounded-lg transition-colors ${
                  showIngredients ? 'bg-accent-500 text-white' : 'bg-white/10 text-white/80 hover:bg-white/20'
                }`}
              >
                🧂 Ingredients
              </button>
              <button onClick={onClose} className="min-w-[44px] min-h-[44px] flex items-center justify-center text-white/70 hover:text-white text-2xl">×</button>
            </div>
          </div>

          {/* Progress dots */}
          <div className="flex items-center px-4 sm:px-8 pb-4 flex-shrink-0 overflow-x-auto scrollbar-none scroll-fade-x">
            {steps.map((_, i) => (
              // Visual dot stays small (w-2 h-2) but the button's own box is
              // padded out to a real 44px tap target — the old version made
              // the whole 8px dot itself the only tappable area.
              <button
                key={i}
                onClick={() => setStepIdx(i)}
                className="flex-shrink-0 min-w-[32px] min-h-[44px] flex items-center justify-center press-feedback"
                aria-label={`Go to step ${i + 1}`}
              >
                <span className={`block rounded-full transition-all ${
                  i === stepIdx ? 'w-6 h-2 bg-accent-400' : 'w-2 h-2 bg-white/25'
                }`} />
              </button>
            ))}
          </div>

          {/* Ingredient checklist overlay */}
          {showIngredients && (
            <div className="mx-4 sm:mx-8 mb-4 p-4 rounded-xl bg-white/10 flex-shrink-0 max-h-[35vh] overflow-y-auto">
              <ul className="flex flex-col gap-1">
                {recipe.ingredients.map(ing => {
                  const checked = done.has(ing.id)
                  return (
                    <li key={ing.id}>
                      <button
                        onClick={() => toggleIngredient(ing.id)}
                        className={`w-full flex items-center gap-2 text-left text-sm rounded-lg px-2 py-1.5 min-h-[40px] transition-colors ${checked ? 'opacity-40' : 'hover:bg-white/10'}`}
                      >
                        <span className={`w-4 h-4 rounded border-2 flex-shrink-0 flex items-center justify-center ${checked ? 'bg-accent-500 border-accent-500' : 'border-white/40'}`}>
                          {checked && <span className="text-white text-[9px] font-bold leading-none">✓</span>}
                        </span>
                        <span className={checked ? 'line-through' : ''}>
                          {ing.quantity != null && <span className="font-semibold tabular-nums mr-1">{ing.quantity}{ing.unit ?? ''}</span>}
                          {ing.name}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}

          {/* Current step — the main event */}
          <div className="flex-1 min-h-0 overflow-y-auto flex items-center px-4 sm:px-8">
            <div className="w-full max-w-2xl mx-auto">
              <span className="text-6xl sm:text-7xl font-black text-white/10 leading-none">{stepIdx + 1}</span>
              <p className="text-xl sm:text-3xl font-medium leading-snug -mt-8 sm:-mt-10">{steps[stepIdx]}</p>
            </div>
          </div>

          {/* Nav */}
          <div className="flex items-center gap-3 px-4 sm:px-8 py-5 flex-shrink-0 border-t border-white/10">
            <button
              onClick={() => setStepIdx(i => Math.max(0, i - 1))}
              disabled={isFirst}
              className="min-h-[52px] px-5 rounded-xl bg-white/10 text-white font-medium disabled:opacity-30 hover:bg-white/20 transition-colors"
            >
              ← Back
            </button>
            <span className="flex-1 text-center text-sm text-white/50 tabular-nums">{stepIdx + 1} / {steps.length}</span>
            {isLast ? (
              <button onClick={onClose} className="min-h-[52px] px-6 rounded-xl bg-accent-500 text-white font-semibold hover:bg-accent-600 transition-colors">
                🎉 Done cooking
              </button>
            ) : (
              <button
                onClick={() => setStepIdx(i => Math.min(steps.length - 1, i + 1))}
                className="min-h-[52px] px-6 rounded-xl bg-accent-500 text-white font-semibold hover:bg-accent-600 transition-colors"
              >
                Next →
              </button>
            )}
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  )
}
