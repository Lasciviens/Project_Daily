import { useMemo } from 'react'
import { HoverPeek } from '../../../shared/components/HoverPeek'
import { Truncate } from '../../../shared/ui'
import { useRecipes } from '../hooks/useRecipes'
import { useIngredientLibrary } from '../hooks/useIngredientLibrary'
import { dayMacroSources, diaryLineFromMeal, oneDecimal, type DiaryLine, type MacroKey } from '../foodIngredients'
import type { DayMeal } from '../../daily/api/dayNutritionApi'

/**
 * One of the Nutrition card's totals ("71g fat"): hover with a mouse or tap
 * for the exact amount, the kcal it carries and the foods it came from.
 */
export function MacroFigure({ macro, label, value, color, meals }: {
  macro: MacroKey
  /** "fat", "sugar"… as the figure says it. */
  label: string
  /** The figure as shown (whole grams). */
  value: number
  color: string
  meals: readonly DayMeal[]
}) {
  return (
    <HoverPeek
      className="flex min-w-0 items-center gap-1 rounded-sm text-left underline decoration-line-strong decoration-dotted underline-offset-2 transition-colors hover:decoration-fg-faint"
      trigger={<>
        <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
        {value}g {label}
      </>}
    >
      <MacroSourcesPanel macro={macro} label={label} meals={meals} />
    </HoverPeek>
  )
}

/** Mounted only while the peek is open; recipes and foods come from the cache the Today tab already fills. */
function MacroSourcesPanel({ macro, label, meals }: { macro: MacroKey; label: string; meals: readonly DayMeal[] }) {
  const { data: recipes = [] } = useRecipes()
  const { data: library = [] } = useIngredientLibrary()
  const s = useMemo(() => {
    const lines = meals.map(diaryLineFromMeal).filter((l): l is DiaryLine => l != null)
    return dayMacroSources(lines, macro, new Map(recipes.map(r => [r.id, r])), new Map(library.map(f => [f.id, f])))
  }, [meals, macro, recipes, library])

  return (
    <div className="flex flex-col gap-2 tabular-nums">
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-ui font-semibold text-fg">{oneDecimal(s.total)} g {label}</span>
        {s.kcal != null && (
          <span className="text-fg-muted">
            ≈ {Math.round(s.kcal).toLocaleString('en-GB')} kcal{s.kcalShare != null && ` · ${s.kcalShare} % of the day`}
          </span>
        )}
      </p>
      {s.items.length === 0 ? <p className="text-fg-muted">Nothing logged has {label} yet.</p> : (
        <ul className="flex flex-col gap-1 border-t border-line pt-2">
          {s.items.map(i => (
            <li key={i.key} className="flex items-baseline gap-3">
              <Truncate className="flex-1 text-fg-2">{i.title}</Truncate>
              <span className="shrink-0 text-fg">{oneDecimal(i.amount)} g</span>
            </li>
          ))}
          {s.more > 0 && (
            <li className="flex items-baseline gap-3 text-fg-muted">
              <span className="flex-1">+{s.more} more</span>
              <span className="shrink-0">{oneDecimal(s.moreAmount)} g</span>
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
