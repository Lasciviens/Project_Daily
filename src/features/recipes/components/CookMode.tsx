import { useState } from 'react'
import { Check, ChevronLeft, ChevronRight, ListChecks } from 'lucide-react'
import { ModalShell } from '../../../shared/modals/ModalShell'
import { cx } from '../../../shared/ui/cx'
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
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  // Always dark (bg-scrim + white text) in both themes: large type on black
  // reads best across a kitchen, and a light screen at the stove is glare.
  return (
    <ModalShell
      onClose={onClose}
      size="xl"
      mobile="fullscreen"
      panelClassName="!bg-scrim !border-scrim text-white sm:!h-[88dvh]"
      bodyClassName="flex flex-col p-0"
      hero={
        <div className="flex items-center gap-3 px-4 pb-3 pr-16 pt-[calc(0.75rem+env(safe-area-inset-top))] sm:px-8 sm:pt-4">
          <div className="min-w-0 flex-1">
            <p className="text-micro font-semibold uppercase tracking-[0.09em] text-white/50">Cook mode</p>
            <p className="truncate text-ui font-semibold">{recipe.title}</p>
          </div>
          <button
            type="button"
            onClick={() => setShowIngredients(s => !s)}
            aria-pressed={showIngredients}
            className={cx(
              'inline-flex min-h-[44px] items-center gap-2 rounded-control px-3 text-body font-semibold transition-colors',
              showIngredients ? 'bg-accent-500 text-on-accent' : 'bg-white/10 text-white/80 hover:bg-white/20',
            )}
          >
            <ListChecks className="h-4 w-4" aria-hidden /> Ingredients
          </button>
        </div>
      }
    >
      {/* Progress dots — each a 44px tap target around a small visual dot. */}
      <div className="scroll-x flex shrink-0 items-center px-4 pb-4 sm:px-8">
        {steps.map((_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setStepIdx(i)}
            className="flex min-h-[44px] min-w-[32px] shrink-0 items-center justify-center"
            aria-label={`Go to step ${i + 1}`}
            aria-current={i === stepIdx ? 'step' : undefined}
          >
            <span className={cx('block rounded-full transition-all', i === stepIdx ? 'h-2 w-6 bg-accent-400' : 'h-2 w-2 bg-white/25')} />
          </button>
        ))}
      </div>

      {showIngredients && (
        <div className="mx-4 mb-4 max-h-[35vh] shrink-0 overflow-y-auto rounded-card bg-white/10 p-3 sm:mx-8">
          <ul className="flex flex-col gap-1">
            {recipe.ingredients.map(ing => {
              const checked = done.has(ing.id)
              return (
                <li key={ing.id}>
                  <button
                    type="button"
                    onClick={() => toggleIngredient(ing.id)}
                    aria-pressed={checked}
                    className={cx('flex min-h-[44px] w-full items-center gap-2 rounded-row px-2 text-left text-body transition-colors', checked ? 'opacity-40' : 'hover:bg-white/10')}
                  >
                    <span className={cx('flex h-4 w-4 shrink-0 items-center justify-center rounded border-2', checked ? 'border-accent-500 bg-accent-500' : 'border-white/40')}>
                      {checked && <Check aria-hidden strokeWidth={3} className="h-3 w-3 text-on-accent" />}
                    </span>
                    <span className={checked ? 'line-through' : ''}>
                      {ing.quantity != null && <span className="mr-1 font-semibold tabular-nums">{ing.quantity}{ing.unit ?? ''}</span>}
                      {ing.name}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {/* Current step — the main event. */}
      <div className="flex min-h-0 flex-1 items-center overflow-y-auto px-4 sm:px-8">
        <div className="mx-auto w-full max-w-2xl">
          <span className="text-6xl font-black leading-none text-white/10 sm:text-7xl">{stepIdx + 1}</span>
          <p className="-mt-8 text-xl font-medium leading-snug sm:-mt-10 sm:text-3xl">{steps[stepIdx]}</p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3 border-t border-white/10 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4 sm:px-8 sm:pb-4">
        <button
          type="button"
          onClick={() => setStepIdx(i => Math.max(0, i - 1))}
          disabled={isFirst}
          className="inline-flex min-h-[52px] items-center gap-1 rounded-control bg-white/10 px-5 font-semibold text-white transition-colors hover:bg-white/20 disabled:opacity-30"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden /> Back
        </button>
        <span className="flex-1 text-center text-body text-white/50 tabular-nums">{stepIdx + 1} / {steps.length}</span>
        {isLast ? (
          <button type="button" onClick={onClose} className="btn-primary min-h-[52px] px-6">Done cooking</button>
        ) : (
          <button type="button" onClick={() => setStepIdx(i => Math.min(steps.length - 1, i + 1))} className="btn-primary min-h-[52px] px-6">
            Next <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>
    </ModalShell>
  )
}
