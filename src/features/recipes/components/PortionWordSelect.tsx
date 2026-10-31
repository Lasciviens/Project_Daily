import { useState } from 'react'
import { useIngredientLibrary } from '../hooks/useIngredientLibrary'
import { useRecipes } from '../hooks/useRecipes'
import { portionWordOptions, presetWord } from '../foodAmount'
import { cx } from '../../../shared/ui'

const OTHER = '__other__'

/**
 * What one portion is called, picked from a list (owner, 31.10.2026: "it's manually written like '1 portion'
 * '1 pc' … It should be options"): the usual words and the owner's own in use (foodAmount.portionWordOptions),
 * then "Other…", which turns the field into a box for a new word. The box keeps what is typed as it is (spaces
 * too — "small bowl") and hands the word over, trimmed, when it is left or Enter is pressed; left empty, the list
 * comes back with the word as it was. The value is the word ('' = none); a food stores it as "1 <word>", a recipe
 * as the word.
 */
export function PortionWordSelect({ value, onChange, ariaLabel, noneLabel, emptyWord, className }: {
  value: string
  onChange: (word: string) => void
  ariaLabel: string
  /** The empty choice's text — a food may have no portion ("No portion"); left out, there is none. */
  noneLabel?: string
  /** The word an empty value reads as (a recipe's serving is "portion" until named). */
  emptyWord?: string
  className?: string
}) {
  const { data: library = [] } = useIngredientLibrary()
  const { data: recipes = [] } = useRecipes()
  // The word being typed after "Other…" (null = the list shows).
  const [draft, setDraft] = useState<string | null>(null)
  const shown = value || emptyWord || ''
  const own = [...library.map(l => presetWord(l.serving_label)), ...recipes.map(r => r.serving_label)]
  const words = portionWordOptions(own, shown)

  if (draft !== null) {
    const commit = () => {
      const w = draft.trim().replace(/\s+/g, ' ')
      if (w) onChange(w)
      setDraft(null)
    }
    return (
      <input
        autoFocus value={draft} maxLength={30} aria-label={ariaLabel} placeholder="A new word, e.g. muffin"
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); commit() }
          if (e.key === 'Escape') { e.preventDefault(); setDraft(null) }
        }}
        className={cx('input', className)}
      />
    )
  }
  return (
    <select
      value={shown} aria-label={ariaLabel} className={cx('select', className)}
      onChange={e => {
        if (e.target.value === OTHER) { setDraft(''); return }
        onChange(e.target.value)
      }}
    >
      {noneLabel != null && <option value="">{noneLabel}</option>}
      {words.map(w => <option key={w} value={w}>{w}</option>)}
      <option value={OTHER}>Other…</option>
    </select>
  )
}
