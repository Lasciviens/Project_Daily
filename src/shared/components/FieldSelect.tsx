// A plain choice's list (Headless UI Listbox), the same list as a search's (FieldOptions): anchored under its row or
// chip, sized to what the keyboard leaves of the screen and never under the status bar (useOptionsRoom), the menu card
// with one line per choice — its words, a short line under them when it needs one (a hint, or why it can't be picked),
// an icon before, a ✓ after the one chosen. Owner, 28.11.2026: "İ loved the dropdown from "Show"/"Movie" selecting... I
// almodt want everything to use that type dropdown.." — every choice on the item screen uses it (THEME §8).
// The button is the caller's (a whole row, a chip): FieldSelect gives it the Listbox's keys and ARIA; `children`
// draws its inside from the choice shown.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Listbox, ListboxButton, ListboxOption, ListboxOptions } from '@headlessui/react'
import { Check } from 'lucide-react'
import { cx, Truncate } from '../ui'
import { midRowCut, OPTIONS_MARGIN, type ListRow } from './fieldOptionsRoom'
import { FIELD_LIST, roomStyle, useOptionsRoom } from './useOptionsRoom'

export interface FieldChoice<T extends string> {
  value: T
  label: string
  /** A short line under the words (what it does), or why it can't be picked when `disabled`. */
  hint?: string
  icon?: ReactNode
  disabled?: boolean
}

export function FieldSelect<T extends string>({ value, options, onChange, label, spoken, buttonClassName, align = 'end', footer, listClassName, disabled, openOnMount = false, children }: {
  value: T
  options: readonly FieldChoice<T>[]
  onChange: (value: T) => void
  /** What it picks ("Alert"): the button's accessible name starts with it, the list's name is it. */
  label: string
  /** The value as it is spoken, when the choice's words don't say it all ("Pick one", a refused send). */
  spoken?: string
  buttonClassName: string
  align?: 'start' | 'end'
  /** A line under the choices (where the setting behind them lives). */
  footer?: ReactNode
  listClassName?: string
  disabled?: boolean
  /** Opened as it shows (a menu's "Move to list…" opens the screen at that row), once the sheet has come in. */
  openOnMount?: boolean
  /** The button's inside, from the choice shown and whether the list is open. */
  children: (shown: FieldChoice<T> | undefined, open: boolean) => ReactNode
}) {
  const shown = options.find(o => o.value === value)
  const button = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!openOnMount) return
    const id = window.setTimeout(() => button.current?.click(), 350)
    return () => window.clearTimeout(id)
  }, [openOnMount])
  return (
    <Listbox value={value} onChange={onChange} disabled={disabled}>
      {({ open }) => (
        <>
          <ListboxButton ref={button} aria-label={`${label}: ${spoken ?? shown?.label ?? value}`} className={buttonClassName}>
            {children(shown, open)}
          </ListboxButton>
          {open && <FieldSelectList button={button} label={label} options={options} align={align} footer={footer} className={listClassName} />}
        </>
      )}
    </Listbox>
  )
}

/** The open list: mounted only while open, so its room is measured when it opens (and kept while it shows). */
function FieldSelectList<T extends string>({ button, label, options, align, footer, className }: {
  button: RefObject<HTMLButtonElement | null>
  label: string
  options: readonly FieldChoice<T>[]
  align: 'start' | 'end'
  footer?: ReactNode
  className?: string
}) {
  // A choice is a .menu-item (44px on touch, its px type; 60 with a hint line): the height the list wants, so a row low
  // on the screen moves up enough to show it. A plain choice's list grows to the room on the screen (no 18rem cap: its
  // choices are few), and where even that is too little it is cut in the middle of a row, so it shows it scrolls.
  const want = options.reduce((h, o) => h + (o.hint ? 60 : 44), 14) + (footer ? 40 : 0)
  const room = useOptionsRoom(button, 6, want, Number.POSITIVE_INFINITY)
  const list = useRef<HTMLDivElement>(null)
  const [drawn, setDrawn] = useState<{ rows: ListRow[]; full: number } | null>(null)
  useLayoutEffect(() => {
    const el = list.current
    if (!el) return
    const rows = [...el.querySelectorAll<HTMLElement>('[role=option]')].map(o => ({ top: o.offsetTop, height: o.offsetHeight }))
    setDrawn({ rows, full: el.scrollHeight + el.offsetHeight - el.clientHeight })
  }, [options.length])
  const height = room === null ? null : drawn ? midRowCut(room, drawn.rows, drawn.full) : room
  return (
    <ListboxOptions static modal={false} aria-label={label} anchor={{ to: `bottom ${align}`, gap: 6, padding: OPTIONS_MARGIN }}
      ref={list} data-field-list="" style={roomStyle(height)} className={cx(FIELD_LIST, 'min-w-[15rem] max-w-[min(22rem,calc(100vw-1.5rem))]', className)}>
      {options.map(o => (
        <ListboxOption key={o.value} value={o.value} disabled={o.disabled}
          className="menu-item cursor-pointer data-[disabled]:cursor-default data-[disabled]:opacity-50 data-[focus]:bg-surface-hover">
          {({ selected }) => (
            <>
              {o.icon}
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="min-w-0"><Truncate>{o.label}</Truncate></span>
                {o.hint && <span className="text-meta text-fg-muted">{o.hint}</span>}
              </span>
              <Check aria-hidden className={cx('h-4 w-4 shrink-0 text-accent-600', selected ? 'visible' : 'invisible')} />
            </>
          )}
        </ListboxOption>
      ))}
      {footer && <p className="px-3 pb-1.5 pt-1 text-meta text-fg-muted">{footer}</p>}
    </ListboxOptions>
  )
}
