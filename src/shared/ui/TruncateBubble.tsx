import { useEffect, useRef } from 'react'
import { Portal } from '@headlessui/react'
import { autoUpdate, flip, offset, shift, useFloating } from '@floating-ui/react'
import { cx } from './cx'

const BUBBLE = 'z-popover max-w-[min(20rem,85vw)] whitespace-pre-line break-words rounded-control border border-line-strong bg-surface px-2.5 py-1.5 text-meta font-medium text-fg shadow-menu select-text motion-pop-in'

interface TruncateBubbleProps {
  reference: HTMLElement
  text: string
  /** Inside /games: the bubble needs the page's own tokens. */
  tg: boolean
  onPointerEnter: () => void
  onPointerLeave: () => void
  onDismiss: () => void
}

/**
 * The full text of a cut <Truncate>, mounted only while it is open. Rendered
 * through Headless UI's Portal: inside a popup that portal lands in the dialog
 * and registers as one of its own containers, so pressing the bubble (to
 * select its text) is not a click outside the popup — a plain body portal
 * closed the popup and threw away what was in it. A press anywhere else or
 * Esc closes the bubble only.
 */
export function TruncateBubble({ reference, text, tg, onPointerEnter, onPointerLeave, onDismiss }: TruncateBubbleProps) {
  const { refs, floatingStyles } = useFloating({
    elements: { reference },
    placement: 'top-start',
    strategy: 'fixed',
    middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  })
  const own = useRef<HTMLDivElement | null>(null)
  const dismiss = useRef(onDismiss)
  useEffect(() => { dismiss.current = onDismiss })

  useEffect(() => {
    const outside = (e: PointerEvent) => {
      const t = e.target as Node
      if (reference.contains(t) || own.current?.contains(t)) return
      dismiss.current()
    }
    // Capture: Esc closes the bubble only, not the popup it sits in.
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      dismiss.current()
    }
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('keydown', esc, true)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('keydown', esc, true)
    }
  }, [reference])

  return (
    <Portal>
      <div
        ref={node => { own.current = node; refs.setFloating(node) }}
        style={floatingStyles}
        role="tooltip"
        className={cx(BUBBLE, tg && 'tg-portal')}
        onPointerEnter={e => { if (e.pointerType === 'mouse') onPointerEnter() }}
        onPointerLeave={e => { if (e.pointerType === 'mouse') onPointerLeave() }}
      >
        {text}
      </div>
    </Portal>
  )
}
