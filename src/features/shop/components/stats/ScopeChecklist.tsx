import { useState, type ReactNode } from 'react'
import { Truncate, cx } from '../../../../shared/ui'
import type { ScopeOption } from './statsScopeOptions'

/**
 * One section of the filter sheet: a heading (how many are picked, Clear) and
 * a checkbox per option. A sub-option whose parent is picked shows ticked and
 * greyed — it is in already. Long lists stop at `cap` rows with "Show all".
 */
export function ScopeChecklist({ title, note, options, picked, onToggle, onClear, cap, noun, children, empty = 'Nothing here.' }: {
  title: string
  note?: string
  options: ScopeOption[]
  picked: string[]
  onToggle: (key: string) => void
  onClear: () => void
  cap?: number
  /** "thing" → "Show all 24 things". */
  noun?: string
  /** Above the list (a search box). */
  children?: ReactNode
  /** When there are no options. */
  empty?: string
}) {
  const [all, setAll] = useState(false)
  const shown = cap && !all ? options.slice(0, cap) : options
  const set = new Set(picked)
  return (
    <section aria-label={title} className="flex flex-col gap-1">
      <header className="flex items-baseline gap-2 px-1">
        <h3 className="section-label">{title}</h3>
        {picked.length > 0 && <span className="text-meta text-fg-muted">· {picked.length} picked</span>}
        {picked.length > 0 && (
          <button type="button" onClick={onClear} className="ml-auto text-meta font-semibold text-accent-600 [@media(pointer:coarse)]:min-h-[44px]">Clear</button>
        )}
      </header>
      {note && <p className="px-1 text-meta text-fg-muted">{note}</p>}
      {children}
      {options.length === 0
        ? <p className="px-1 py-2 text-body text-fg-muted">{empty}</p>
        : (
          <ul className="flex flex-col">
            {shown.map(o => {
              const implied = !!o.parent && set.has(o.parent)
              return (
                <li key={o.key}>
                  <label className={cx('row min-h-[44px] py-1', o.depth === 1 && 'pl-9', implied ? 'cursor-default' : 'row-interactive cursor-pointer')}>
                    <input
                      type="checkbox" checked={implied || set.has(o.key)} disabled={implied} onChange={() => onToggle(o.key)}
                      className="h-[18px] w-[18px] shrink-0 accent-accent-500"
                    />
                    <span className={cx('min-w-0 flex-1', implied && 'opacity-70')}>
                      <Truncate className={cx('text-body', o.depth === 0 ? 'font-medium text-fg' : 'text-fg-2')}>{o.label}</Truncate>
                      {(o.meta || implied) && <Truncate className="text-meta text-fg-muted">{implied ? 'Included with the one above' : o.meta}</Truncate>}
                    </span>
                    {o.count != null && <span className="shrink-0 text-meta tabular-nums text-fg-muted">{o.count}</span>}
                  </label>
                </li>
              )
            })}
          </ul>
        )}
      {cap != null && options.length > cap && (
        <button type="button" onClick={() => setAll(v => !v)} className="self-start px-1 text-meta font-semibold text-accent-600 [@media(pointer:coarse)]:min-h-[44px]">
          {all ? 'Show fewer' : `Show all ${options.length} ${noun ?? 'options'}`}
        </button>
      )}
    </section>
  )
}
