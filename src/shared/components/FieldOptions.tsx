// A text field's suggestion list (Headless UI ComboboxOptions, anchored under the field), for the item screen's
// searches and name fields. On a phone the keyboard covers half the screen: the list is sized to the room under its
// field that the keyboard leaves (window.visualViewport), so it stays under the field instead of flipping over the rows
// above it — with too little room the field is first scrolled up (optionsLift) — and a list that still has to go above
// stops under the status bar (fieldOptionsRoom.optionsMaxHeight).

import { useEffect, useState, type ReactNode, type RefObject } from 'react'
import { ComboboxOptions } from '@headlessui/react'
import { cx } from '../ui'
import { OPTIONS_MARGIN, optionsLift, optionsMaxHeight } from './fieldOptionsRoom'

/** WebKit gives an anchored list's client coordinates against the visual viewport (Floating UI's own rule). */
const webkit = () => typeof CSS !== 'undefined' && CSS.supports?.('-webkit-backdrop-filter', 'none')

/** The top safe area now (the status bar in the installed iPhone app; it changes when the phone turns), from env(). */
function readSafeTop(): number {
  const probe = document.createElement('div')
  probe.style.cssText = 'position:fixed;visibility:hidden;padding-top:env(safe-area-inset-top,0px)'
  document.body.appendChild(probe)
  const top = parseFloat(getComputedStyle(probe).paddingTop) || 0
  probe.remove()
  return top
}

/** The nearest box that scrolls the field (the sheet's body). */
function scrollerOf(el: HTMLElement): HTMLElement | null {
  for (let a = el.parentElement; a; a = a.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(a).overflowY) && a.scrollHeight > a.clientHeight) return a
  }
  return null
}

/** The list's max height for the field now, kept current while the keyboard, the sheet or the page moves. Too little
 *  room under the field (the keyboard up on a small phone): the field is scrolled up first, so the list fits under it. */
function useOptionsRoom(field: RefObject<HTMLElement | null>, gap: number): number | null {
  const [room, setRoom] = useState<number | null>(null)
  useEffect(() => {
    let frame = 0
    let lifted = 0
    const measure = () => {
      frame = 0
      const el = field.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const vv = window.visualViewport
      const top = vv && !webkit() ? vv.offsetTop : 0
      const height = vv ? vv.height : window.innerHeight
      const visible = { top, bottom: top + height, safeTop: readSafeTop() }
      const lift = optionsLift({ top: r.top, bottom: r.bottom }, visible, gap)
      const scroller = lift > 0 && lifted < 2 ? scrollerOf(el) : null
      if (scroller) {
        // At most twice (the keyboard may still be opening): never a fight with the owner's own scrolling.
        lifted++
        scroller.scrollTop += lift
        soon()
        return
      }
      setRoom(optionsMaxHeight({ top: r.top, bottom: r.bottom }, visible, gap))
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
      // The var alone is not enough: Headless UI writes its min(var(--anchor-max-height), room) back as a fixed px
      // value, so a keyboard opening after the list keeps it at its old height and Floating UI flips it above (the
      // audit's KEYBOARD case). React's own max-height, set again on each new room, shrinks it and it comes back under.
      style={room === null ? undefined : { ['--anchor-max-height' as string]: `${room}px`, maxHeight: `${room}px` }}
      className={cx('menu z-toast overflow-y-auto overscroll-contain', className)}>
      {children}
    </ComboboxOptions>
  )
}
