import type { ReactNode } from 'react'
import { Listbox, ListboxButton, ListboxLabel, ListboxOption, ListboxOptions } from '@headlessui/react'
import { Check, ChevronDown } from 'lucide-react'

export interface TgOption<T extends string> { value: T; label: string; count?: number; status?: string }

/**
 * The design's filter pill ("All Status ▾") as a Headless UI Listbox.
 *
 * `className` lands on the button itself: Listbox renders no wrapper and the
 * options are portaled, so the button IS the element that sits in the
 * caller's flex row. `icon` (optional) replaces the label below `lg`, where
 * the tablet top bar has no room for three text pills; the label stays
 * readable to screen readers there.
 */
export function TgDropdown<T extends string>({
  value, options, onChange, buttonLabel, ariaLabel, align = 'start', className = '', fullWidth = false, icon,
}: {
  value: T
  options: TgOption<T>[]
  onChange: (v: T) => void
  buttonLabel: string
  ariaLabel: string
  align?: 'start' | 'end'
  className?: string
  fullWidth?: boolean
  icon?: ReactNode
}) {
  // Rows without a status keep the dot's slot so every label lines up.
  const hasDots = options.some(o => o.status)
  return (
    <Listbox value={value} onChange={onChange}>
      <ListboxLabel className="sr-only">{ariaLabel}</ListboxLabel>
      <ListboxButton
        title={icon ? buttonLabel : undefined}
        className={`tg-select min-w-0 ${fullWidth ? 'w-full justify-between' : ''} ${className}`}
      >
        {icon && <span aria-hidden className="inline-flex lg:hidden">{icon}</span>}
        <span className={icon ? 'sr-only lg:not-sr-only lg:min-w-0 lg:truncate' : 'min-w-0 truncate'}>{buttonLabel}</span>
        <ChevronDown aria-hidden className="tg-chev ml-auto shrink-0" strokeWidth={2} />
      </ListboxButton>
      <ListboxOptions
        anchor={{ to: align === 'end' ? 'bottom end' : 'bottom start', gap: 6, padding: 12 }}
        transition
        className="tg-portal tg-menu w-max min-w-[var(--button-width)] max-w-[min(20rem,calc(100vw-24px))] max-h-80 overflow-y-auto transition duration-150 ease-out data-[closed]:-translate-y-1 data-[closed]:opacity-0"
      >
        {options.map(o => (
          <ListboxOption key={o.value} value={o.value} className="tg-menu-item">
            {({ selected }) => (
              <>
                {hasDots && <span aria-hidden data-status={o.status} className={`tg-dot ${o.status ? '' : 'invisible'}`} />}
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {o.count != null && (
                  <span className="pl-3 text-[12px] font-medium tabular-nums text-[var(--tg-muted)]">{o.count}</span>
                )}
                <Check aria-hidden className={`h-4 w-4 shrink-0 ${selected ? '' : 'invisible'}`} strokeWidth={2.2} />
              </>
            )}
          </ListboxOption>
        ))}
      </ListboxOptions>
    </Listbox>
  )
}
