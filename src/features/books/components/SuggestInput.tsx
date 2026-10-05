import { useId, useMemo, useState, type KeyboardEvent } from 'react'
import { X } from 'lucide-react'
import { cx } from '../../../shared/ui'
import { canonical, foldKey, suggest } from '../libraryFacets'

/**
 * A text field that offers what the library already has while you type
 * ("Rowl" → "J. K. Rowling"). Picking one, or leaving the field with a value
 * that matches one apart from case and accents, uses the library's own
 * spelling — so one author never ends up under two names.
 */
export function SuggestInput({ value, onChange, values, label, placeholder, className }: {
  value: string
  onChange: (v: string) => void
  /** What the library already uses for this field. */
  values: readonly string[]
  label: string
  placeholder?: string
  className?: string
}) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const hits = useMemo(() => suggest(values, value), [values, value])
  const exact = values.find(v => foldKey(v) === foldKey(value) && v !== value.trim())
  const options = exact ? [exact, ...hits.filter(h => h !== exact)] : hits
  const show = open && options.length > 0
  const pick = (v: string) => { onChange(v); setOpen(false) }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!show) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, options.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); pick(options[active]) }
    else if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) }
  }
  return (
    <div className={cx('relative', className)}>
      <input
        role="combobox" aria-expanded={show} aria-controls={`${id}-list`} aria-autocomplete="list" aria-label={label}
        aria-activedescendant={show ? `${id}-${active}` : undefined}
        className="input min-h-[44px] w-full" value={value} placeholder={placeholder}
        onChange={e => { onChange(e.target.value); setOpen(true); setActive(0) }}
        onFocus={() => setOpen(true)}
        onBlur={() => { setOpen(false); const c = canonical(values, value); if (c !== value) onChange(c) }}
        onKeyDown={onKey} />
      {show && (
        <ul id={`${id}-list`} role="listbox" className="absolute inset-x-0 top-full z-popover mt-1 max-h-60 overflow-auto rounded-menu border border-line-strong bg-surface p-1 shadow-menu">
          {options.map((o, i) => (
            <li key={o} id={`${id}-${i}`} role="option" aria-selected={i === active}
              onMouseDown={e => { e.preventDefault(); pick(o) }} onMouseEnter={() => setActive(i)}
              className={cx('flex min-h-[40px] cursor-pointer items-center gap-2 rounded-control px-2.5 text-body',
                i === active ? 'bg-accent-50 text-fg' : 'text-fg-2')}>
              <span className="min-w-0 flex-1 break-words">{o}</span>
              {o === exact && <span className="text-micro text-fg-muted">In your library</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Several values as chips (categories, subjects), with the same suggestions. Enter or comma adds one. */
export function TagInput({ value, onChange, values, label, placeholder }: {
  value: string[]
  onChange: (v: string[]) => void
  values: readonly string[]
  label: string
  placeholder?: string
}) {
  const [draft, setDraft] = useState('')
  const free = useMemo(() => values.filter(v => !value.some(t => foldKey(t) === foldKey(v))), [values, value])
  const add = (t: string) => {
    const c = canonical(values, t)
    if (c && !value.some(x => foldKey(x) === foldKey(c))) onChange([...value, c])
    setDraft('')
  }
  return (
    <div className="flex flex-col gap-2">
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={label}>
          {value.map(t => (
            <li key={t} className="inline-flex min-h-[32px] items-center gap-1 rounded-full border border-line bg-surface-2 pl-3 pr-1 text-meta text-fg">
              {t}
              <button type="button" aria-label={`Remove ${t}`} onClick={() => onChange(value.filter(x => x !== t))}
                className="grid h-7 w-7 place-items-center rounded-full text-fg-muted hover:bg-surface-hover hover:text-fg">
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div onKeyDownCapture={e => {
        if ((e.key === 'Enter' || e.key === ',') && draft.trim() && !(e.target as HTMLElement).getAttribute('aria-activedescendant')) {
          e.preventDefault(); add(draft)
        }
      }}>
        <SuggestInput value={draft} values={free} label={`Add ${label.toLowerCase()}`} placeholder={placeholder}
          onChange={v => {
            if (v.endsWith(',')) { add(v.slice(0, -1)); return }
            // A suggestion picked from the list arrives as a whole existing value.
            if (free.includes(v) && v !== draft) { add(v); return }
            setDraft(v)
          }} />
      </div>
    </div>
  )
}
