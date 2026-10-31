import { useState } from 'react'
import { useIngredientLibrary } from '../hooks/useIngredientLibrary'
import { useRecipes } from '../hooks/useRecipes'
import { portionWordOptions, presetWord } from '../foodAmount'
import { cx } from '../../../shared/ui'

const OTHER = '__other__'

/**
 * What one portion is called, picked from a list (owner, 31.10.2026: "it's manually written like '1 portion'
 * '1 pc' … It should be options"): the usual words and the owner's own in use (foodAmount.portionWordOptions),
 * then "Other…", which turns the field into a box for a new word. The value is the word ('' = none); a food stores
 * it as "1 <word>", a recipe as the word.
 */
export function PortionWordSelect({ value, onChange, ariaLabel, noneLabel, className }: {
  value: string
  onChange: (word: string) => void
  ariaLabel: string
  /** The empty choice's text — a food may have no portion ("No portion"); left out, there is none. */
  noneLabel?: string
  className?: string
}) {
  const { data: library = [] } = useIngredientLibrary()
  const { data: recipes = [] } = useRecipes()
  const [typing, setTyping] = useState(false)
  const own = [...library.map(l => presetWord(l.serving_label)), ...recipes.map(r => r.serving_label)]
  const words = portionWordOptions(own, value)

  if (typing) {
    return (
      <input
        autoFocus value={value} maxLength={30} aria-label={ariaLabel} placeholder="A new word, e.g. muffin"
        onChange={e => onChange(e.target.value)}
        onBlur={() => { if (!value.trim()) setTyping(false) }}
        className={cx('input', className)}
      />
    )
  }
  return (
    <select
      value={value} aria-label={ariaLabel} className={cx('select', className)}
      onChange={e => {
        if (e.target.value === OTHER) { onChange(''); setTyping(true); return }
        onChange(e.target.value)
      }}
    >
      {noneLabel != null && <option value="">{noneLabel}</option>}
      {words.map(w => <option key={w} value={w}>{w}</option>)}
      <option value={OTHER}>Other…</option>
    </select>
  )
}
