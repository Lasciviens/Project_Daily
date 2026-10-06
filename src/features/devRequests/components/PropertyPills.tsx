import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { ToneDot, Truncate, cx, type Tone } from '../../../shared/ui'

// The request's details as a row of pill buttons (icon · value · chevron).
// A tap opens that property's options as a tray of chips right under the
// row — inside the request window, never a portalled menu: the window floats
// over popups (it is not a Dialog), where a portalled list would end up
// behind or inert. One tray at a time; Esc or picking closes it.

export interface PropertyOption<V extends string> { value: V; label: string; tone?: Tone }

export interface Property {
  id: string
  /** Accessible name and the tray's heading ("Priority"). */
  name: string
  icon: ReactNode
  value: string
  options: PropertyOption<string>[]
  onChange: (value: string) => void
  disabled?: boolean
  /** Many options (pages): a scrolling list instead of chips. */
  list?: boolean
}

const PILL = cx(
  'inline-flex h-8 min-w-0 max-w-[14rem] items-center gap-1.5 rounded-full border px-2.5 text-meta font-medium transition-colors duration-100',
  '[@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:px-3 disabled:opacity-60',
  '[&>svg:first-child]:h-3.5 [&>svg:first-child]:w-3.5 [&>svg:first-child]:shrink-0 [&>svg:first-child]:text-fg-muted',
)

export function PropertyPills({ items, className }: { items: Property[]; className?: string }) {
  const [open, setOpen] = useState<string | null>(null)
  const trayRef = useRef<HTMLDivElement>(null)
  const current = items.find(i => i.id === open) ?? null
  useEffect(() => {
    if (!open) return
    trayRef.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [open])

  return (
    <div className={cx('flex flex-col gap-2', className)} onKeyDown={e => { if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(null) } }}>
      <div className="flex flex-wrap items-center gap-1.5">
        {items.map(it => {
          const opt = it.options.find(o => o.value === it.value)
          const on = open === it.id
          return (
            <button
              key={it.id}
              type="button"
              disabled={it.disabled}
              aria-expanded={on}
              aria-label={`${it.name}: ${opt?.label ?? it.value}`}
              title={it.name}
              onClick={() => setOpen(on ? null : it.id)}
              className={cx(PILL, on ? 'border-accent-500/50 bg-accent-50 text-accent-700' : 'border-line bg-surface text-fg-2 [@media(hover:hover)]:hover:border-line-strong [@media(hover:hover)]:hover:bg-surface-hover')}
            >
              {it.icon}
              {opt?.tone && <ToneDot tone={opt.tone} className="shrink-0" />}
              <Truncate reveal="none" className="min-w-0">{opt?.label ?? it.value}</Truncate>
              <ChevronDown aria-hidden className={cx('h-3.5 w-3.5 shrink-0 text-fg-faint transition-transform', on && 'rotate-180')} />
            </button>
          )
        })}
      </div>
      {current && (
        <div ref={trayRef} role="group" aria-label={current.name} className="rounded-row border border-line bg-surface-2 p-1.5">
          <p className="section-label px-1 pb-1.5">{current.name}</p>
          <div className={cx(current.list ? 'flex max-h-48 flex-col overflow-y-auto' : 'flex flex-wrap gap-1')}>
            {current.options.map(o => {
              const on = o.value === current.value
              return (
                <button
                  key={o.value}
                  type="button"
                  aria-pressed={on}
                  onClick={() => { current.onChange(o.value); setOpen(null) }}
                  className={cx(
                    'inline-flex min-h-[32px] min-w-0 items-center gap-1.5 text-meta font-medium transition-colors duration-100 [@media(pointer:coarse)]:min-h-[44px]',
                    current.list ? 'w-full rounded-control px-2 text-left' : 'rounded-full border px-2.5',
                    on
                      ? current.list ? 'bg-accent-50 text-accent-700' : 'border-accent-500/50 bg-accent-50 text-accent-700'
                      : current.list ? 'text-fg-2 [@media(hover:hover)]:hover:bg-surface-hover' : 'border-line bg-surface text-fg-2 [@media(hover:hover)]:hover:border-line-strong',
                  )}
                >
                  {o.tone && <ToneDot tone={o.tone} className="shrink-0" />}
                  <Truncate reveal="none" className="min-w-0 flex-1">{o.label}</Truncate>
                  {on && <Check aria-hidden className="h-3.5 w-3.5 shrink-0" />}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
