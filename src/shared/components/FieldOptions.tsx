// A text field's suggestion list (Headless UI ComboboxOptions, anchored under the field), for the item screen's
// searches and name fields — the plain choices' list is FieldSelect, the same list for a Listbox. On a phone the keyboard covers half the screen: the list is sized to the room under its
// field that the keyboard leaves (window.visualViewport), so it stays under the field instead of flipping over the rows
// above it — with too little room the field is first scrolled up (optionsLift) — and a list that still has to go above
// stops under the status bar (fieldOptionsRoom.optionsMaxHeight).

import type { ReactNode, RefObject } from 'react'
import { ComboboxOptions } from '@headlessui/react'
import { cx } from '../ui'
import { OPTIONS_MARGIN } from './fieldOptionsRoom'
import { FIELD_LIST, roomStyle, useOptionsRoom } from './useOptionsRoom'

/** The list under `field` (its end or start edge lined up with the field's), above the sheet (z-toast). */
export function FieldOptions({ field, align = 'end', gap = 6, className, children }: {
  field: RefObject<HTMLElement | null>
  align?: 'start' | 'end'
  gap?: number
  className?: string
  children: ReactNode
}) {
  const room = useOptionsRoom(field, gap)
  return (
    <ComboboxOptions modal={false} anchor={{ to: `bottom ${align}`, gap, padding: OPTIONS_MARGIN }}
      data-field-list="" style={roomStyle(room)} className={cx(FIELD_LIST, className)}>
      {children}
    </ComboboxOptions>
  )
}
