import { useCallback, useRef, type ReactNode, type RefObject } from 'react'
import { Listbox, ListboxButton, ListboxOption, ListboxOptions } from '@headlessui/react'
import { Check, ChevronDown } from 'lucide-react'
import { ToneDot, Truncate, cx, type Tone } from '../../../shared/ui'
import { placeDropdown } from './propertyPillsPlacement'

// The request's details as a row of pill buttons (icon · value · chevron).
// A tap opens that property's options as a dropdown over the content —
// nothing moves. The list stays inside the request window's DOM, so it is
// part of the window (data-dev-request-ui: page picking ignores it) and
// stacks with it above the popups it floats over. No `anchor`: Headless UI
// always portals an anchored list into #headlessui-portal-root, onto the
// menu layer — behind the window (z-float) and behind any popup open under
// it. Placed with position: fixed (propertyPillsPlacement.ts), the list is
// not clipped by the window's scroll area.

export interface PropertyOption<V extends string> { value: V; label: string; tone?: Tone }

export interface Property {
  id: string
  /** Accessible name ("Priority"); also the pill's tooltip. */
  name: string
  icon: ReactNode
  value: string
  options: PropertyOption<string>[]
  onChange: (value: string) => void
  disabled?: boolean
}

const PILL = cx(
  'inline-flex h-8 min-w-0 max-w-[14rem] items-center gap-1.5 rounded-full border px-2.5 text-meta font-medium transition-colors duration-100',
  'disabled:opacity-60',
  '[&>svg:first-child]:h-3.5 [&>svg:first-child]:w-3.5 [&>svg:first-child]:shrink-0 [&>svg:first-child]:text-fg-muted',
  'border-line bg-surface text-fg-2 [@media(hover:hover)]:hover:border-line-strong [@media(hover:hover)]:hover:bg-surface-hover',
  'data-[open]:border-accent-500/50 data-[open]:bg-accent-50 data-[open]:text-accent-700',
)

const LIST = cx(
  'menu scroll-y fixed w-max max-w-[min(18rem,calc(100vw-1rem))] overflow-y-auto',
  'transition duration-100 ease-out data-[closed]:opacity-0 data-[closed]:-translate-y-1 data-[side=above]:data-[closed]:translate-y-1',
)

export function PropertyPills({ items, className }: { items: Property[]; className?: string }) {
  return (
    <div className={cx('flex flex-wrap items-center gap-1.5', className)}>
      {items.map(it => <PropertyPill key={it.id} item={it} />)}
    </div>
  )
}

function PropertyPill({ item }: { item: Property }) {
  const pillRef = useRef<HTMLButtonElement>(null)
  const listRef = useAnchoredList(pillRef)
  const current = item.options.find(o => o.value === item.value)
  const label = current?.label ?? item.value
  return (
    <Listbox value={item.value} onChange={item.onChange} disabled={item.disabled}>
      <ListboxButton ref={pillRef} aria-label={`${item.name}: ${label}`} title={item.name} className={cx('group', PILL)}>
        {item.icon}
        {current?.tone && <ToneDot tone={current.tone} className="shrink-0" />}
        <Truncate reveal="none" className="min-w-0">{label}</Truncate>
        <ChevronDown aria-hidden className="h-3.5 w-3.5 shrink-0 text-fg-faint transition-transform group-data-[open]:rotate-180" />
      </ListboxButton>
      {/* modal={false}: no scroll lock and nothing made inert — a popup may be open behind the window. */}
      <ListboxOptions ref={listRef} modal={false} transition className={LIST}>
        {item.options.map(o => (
          <ListboxOption key={o.value} value={o.value} className="menu-item gap-2 data-[selected]:text-accent-700">
            {({ selected }) => (
              <>
                {o.tone && <ToneDot tone={o.tone} className="shrink-0" />}
                <Truncate reveal="none" className="min-w-0 flex-1">{o.label}</Truncate>
                <Check aria-hidden className={cx('h-3.5 w-3.5 shrink-0', !selected && 'invisible')} />
              </>
            )}
          </ListboxOption>
        ))}
      </ListboxOptions>
    </Listbox>
  )
}

/**
 * A ref for the open list: places it at its pill as it mounts (before it is
 * painted) and again on every scroll or resize until it unmounts.
 */
function useAnchoredList(pillRef: RefObject<HTMLElement | null>) {
  const detach = useRef<(() => void) | null>(null)
  return useCallback((list: HTMLElement | null) => {
    detach.current?.()
    detach.current = null
    const pill = pillRef.current
    if (list && pill) detach.current = keepAtPill(list, pill)
  }, [pillRef])
}

function keepAtPill(list: HTMLElement, pill: HTMLElement): () => void {
  let frame = 0
  const place = () => {
    frame = 0
    const r = pill.getBoundingClientRect()
    list.style.minWidth = `${r.width}px`
    const vv = window.visualViewport
    const p = placeDropdown(
      { top: r.top, bottom: r.bottom, left: r.left },
      // offset sizes ignore the entrance transform; scrollHeight is the whole list, borders added.
      { width: list.offsetWidth, height: list.scrollHeight + list.offsetHeight - list.clientHeight },
      { width: document.documentElement.clientWidth, height: vv ? vv.offsetTop + vv.height : window.innerHeight },
    )
    list.style.top = `${p.top}px`
    list.style.left = `${p.left}px`
    list.style.maxHeight = `${p.maxHeight}px`
    list.dataset.side = p.above ? 'above' : 'below'
  }
  const schedule = () => { if (!frame) frame = requestAnimationFrame(place) }
  place()
  window.addEventListener('scroll', schedule, true)
  window.addEventListener('resize', schedule)
  return () => {
    cancelAnimationFrame(frame)
    window.removeEventListener('scroll', schedule, true)
    window.removeEventListener('resize', schedule)
  }
}
