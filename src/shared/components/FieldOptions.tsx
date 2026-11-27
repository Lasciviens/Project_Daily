// A text field's suggestion list (Headless UI ComboboxOptions, anchored under the field), for the item screen's
// searches and name fields. On a phone the keyboard covers half the screen: the list is sized to the room under its
// field that the keyboard leaves (window.visualViewport), so it stays under the field instead of flipping over the rows
// above it, and a list that has to go above stops under the status bar (fieldOptionsRoom.optionsMaxHeight).

import { useEffect, useState, type ReactNode, type RefObject } from 'react'
import { ComboboxOptions } from '@headlessui/react'
import { cx } from '../ui'
import { OPTIONS_MARGIN, optionsMaxHeight } from './fieldOptionsRoom'

/** WebKit gives an anchored list's client coordinates against the visual viewport (Floating UI's own rule). */
const webkit = () => typeof CSS !== 'undefined' && CSS.supports?.('-webkit-backdrop-filter', 'none')

/** The top safe area (the status bar in the installed iPhone app), read once from env(). */
let safeTop: number | null = null
function readSafeTop(): number {
  if (safeTop !== null) return safeTop
  const probe = document.createElement('div')
  probe.style.cssText = 'position:fixed;visibility:hidden;padding-top:env(safe-area-inset-top,0px)'
  document.body.appendChild(probe)
  safeTop = parseFloat(getComputedStyle(probe).paddingTop) || 0
  probe.remove()
  return safeTop
}

/** The list's max height for the field now, kept current while the keyboard, the sheet or the page moves. */
function useOptionsRoom(field: RefObject<HTMLElement | null>, gap: number): number | null {
  const [room, setRoom] = useState<number | null>(null)
  useEffect(() => {
    let frame = 0
    const measure = () => {
      frame = 0
      const el = field.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const vv = window.visualViewport
      const top = vv && !webkit() ? vv.offsetTop : 0
      const height = vv ? vv.height : window.innerHeight
      setRoom(optionsMaxHeight({ top: r.top, bottom: r.bottom }, { top, bottom: top + height, safeTop: readSafeTop() }, gap))
    }
    const soon = () => { if (!frame) frame = requestAnimationFrame(measure) }
    measure()
    window.visualViewport?.addEventListener('resize', soon)
    window.visualViewport?.addEventListener('scroll', soon)
    window.addEventListener('resize', soon)
    window.addEventListener('scroll', soon, true)
    return () => {
      cancelAnimationFrame(frame)
      window.visualViewport?.removeEventListener('resize', soon)
      window.visualViewport?.removeEventListener('scroll', soon)
      window.removeEventListener('resize', soon)
      window.removeEventListener('scroll', soon, true)
    }
  }, [field, gap])
  return room
}

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
      style={room === null ? undefined : { ['--anchor-max-height' as string]: `${room}px`, maxHeight: `${room}px` }}
      className={cx('menu z-toast overflow-y-auto overscroll-contain', className)}>
      {children}
    </ComboboxOptions>
  )
}
