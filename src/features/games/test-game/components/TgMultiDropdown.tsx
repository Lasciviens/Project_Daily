import type { ReactNode } from 'react'
import { Listbox, ListboxButton, ListboxLabel, ListboxOption, ListboxOptions } from '@headlessui/react'
import { Check, ChevronDown } from 'lucide-react'
import type { TgOption } from './TgDropdown'

/** The "All" row's value. Real values are never empty, so '' is free. */
const TG_ALL = ''

/**
 * TgDropdown's multi-select sibling: the same filter pill, but its menu is a
 * checklist that stays open while you tick several values. The first row
 * ("All …") is checked when nothing is picked and clears the picks when
 * tapped. `values` empty = no filter.
 */
export function TgMultiDropdown<T extends string>({
  values, options, allLabel, onChange, buttonLabel, ariaLabel, align = 'start', className = '', icon,
}: {
  values: readonly T[]
  options: TgOption<T>[]
  allLabel: string
  onChange: (next: T[]) => void
  buttonLabel: string
  ariaLabel: string
  align?: 'start' | 'end'
  className?: string
  icon?: ReactNode
}) {
  const active = values.length > 0
  const hasDots = options.some(o => o.status)
  const rows: TgOption<string>[] = [{ value: TG_ALL, label: allLabel }, ...options]
  const value: string[] = active ? [...values] : [TG_ALL]

  function change(next: string[]) {
    // Ticking "All" while something is picked clears; any other tick drops "All".
    if (active && next.includes(TG_ALL)) onChange([])
    else onChange(next.filter(v => v !== TG_ALL) as T[])
  }

  return (
    <Listbox value={value} onChange={change} multiple>
      <ListboxLabel className="sr-only">{ariaLabel}</ListboxLabel>
      <ListboxButton
        title={icon ? buttonLabel : undefined}
        className={`tg-select relative min-w-0 ${icon && active ? 'max-lg:!border-[var(--tg-accent)]' : ''} ${className}`}
      >
        {icon && (
          <span aria-hidden className={`inline-flex lg:hidden ${active ? 'text-[var(--tg-accent)]' : ''}`}>{icon}</span>
        )}
        {icon && active && (
          <span
            aria-hidden
            className="absolute right-1 top-1 h-2 w-2 rounded-full bg-[var(--tg-accent)] ring-2 ring-[var(--tg-panel)] lg:hidden"
          />
        )}
        <span className={icon ? 'sr-only lg:not-sr-only lg:min-w-0 lg:truncate' : 'min-w-0 truncate'}>{buttonLabel}</span>
        <ChevronDown aria-hidden className="tg-chev ml-auto shrink-0" strokeWidth={2} />
      </ListboxButton>
      <ListboxOptions
        anchor={{ to: align === 'end' ? 'bottom end' : 'bottom start', gap: 6, padding: 12 }}
        transition
        className="tg-portal tg-menu w-max min-w-[var(--button-width)] max-w-[min(20rem,calc(100vw-24px))] max-h-80 overflow-y-auto transition duration-150 ease-out data-[closed]:-translate-y-1 data-[closed]:opacity-0"
      >
        {rows.map(o => (
          <ListboxOption key={o.value} value={o.value} className="tg-menu-item">
            {({ selected }) => (
              <>
                <span
                  aria-hidden
                  className={`grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[5px] border ${
                    selected
                      ? 'border-transparent bg-[var(--tg-accent)] text-[var(--tg-on-accent,#fff)]'
                      : 'border-[var(--tg-border-strong)]'
                  }`}
                >
                  {selected && <Check className="h-3 w-3" strokeWidth={3} />}
                </span>
                {hasDots && <span aria-hidden data-status={o.status} className={`tg-dot ${o.status ? '' : 'invisible'}`} />}
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {o.count != null && (
                  <span className="pl-3 text-[12px] font-medium tabular-nums text-[var(--tg-muted)]">{o.count}</span>
                )}
              </>
            )}
          </ListboxOption>
        ))}
      </ListboxOptions>
    </Listbox>
  )
}
