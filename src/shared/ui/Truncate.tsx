import { useCallback, useState, type ElementType, type ReactNode } from 'react'
import {
  FloatingPortal, autoUpdate, flip, offset, shift,
  useClick, useDismiss, useFloating, useHover, useInteractions,
} from '@floating-ui/react'
import { useIsTruncated } from '../hooks/useIsTruncated'
import { TAPPABLE_SELECTOR, revealModeFor, truncateClass, type TruncateLines, type TruncateReveal } from './truncateRules'
import { cx } from './cx'

type TruncateTag = 'span' | 'p' | 'div' | 'h2' | 'h3' | 'h4' | 'strong'

interface TruncateProps {
  children: ReactNode
  /** 1 = one line with an ellipsis; 2–3 = a clamp (notes, descriptions). */
  lines?: TruncateLines
  as?: TruncateTag
  className?: string
  /** How the rest is shown when the text is cut (see truncateRules). */
  reveal?: TruncateReveal
  /** The full text when `children` isn't plain text; otherwise the element's own text. */
  fullText?: string
}

const BUBBLE = 'z-popover max-w-[min(20rem,85vw)] whitespace-pre-line break-words rounded-control border border-line-strong bg-surface px-2.5 py-1.5 text-meta font-medium text-fg shadow-menu select-text motion-pop-in'

/**
 * Text that stops at its box and reveals the rest only when it is really cut
 * (THEME.md §5): always a `title`; a mouse tooltip after 400ms; outside a
 * tappable element a tap / click / Enter opens a bubble with the full text
 * (one line) or an in-place "More" expands it (2–3 lines). Inside a tappable
 * row nothing extra happens on touch — the row itself opens the item.
 * Screen readers always read the full text: CSS truncation removes nothing.
 */
export function Truncate({ children, lines = 1, as = 'span', className, reveal = 'auto', fullText }: TruncateProps) {
  const [el, setEl] = useState<HTMLElement | null>(null)
  const [place, setPlace] = useState<{ tappable: boolean; tg: boolean; root: HTMLElement | null }>({ tappable: false, tg: false, root: null })
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const plain = typeof children === 'string' || typeof children === 'number' ? String(children) : undefined
  const textKey = fullText ?? plain
  const cut = useIsTruncated(el, lines, textKey)
  const mode = revealModeFor({ lines, reveal, insideTappable: place.tappable })

  const { refs, floatingStyles, context } = useFloating({
    open: open && cut,
    onOpenChange: setOpen,
    placement: 'top-start',
    strategy: 'fixed',
    middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  })
  const hover = useHover(context, { enabled: cut && mode !== 'more', mouseOnly: true, delay: { open: 400, close: 80 } })
  const click = useClick(context, { enabled: cut && mode === 'popover' })
  // In a row, pressing it opens the item — the tooltip must not linger over the popup.
  const dismiss = useDismiss(context, { referencePress: mode === 'hover' })
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, click, dismiss])

  const setRef = useCallback((node: HTMLElement | null) => {
    setEl(node)
    refs.setReference(node)
    if (!node) return
    setPlace({
      // A control around the text (a row) or inside it (an ⓘ in a title) rules out a trigger.
      tappable: !!node.parentElement?.closest(TAPPABLE_SELECTOR) || !!node.querySelector(TAPPABLE_SELECTOR),
      tg: !!node.closest('.tg-root'),
      // Inside a popup the bubble must live in the dialog: a portal outside it
      // is inert there, and pressing it would count as a click outside.
      root: node.closest<HTMLElement>('[role="dialog"]'),
    })
  }, [refs])
  const setFloatingEl = useCallback((node: HTMLElement | null) => refs.setFloating(node), [refs])

  const text = textKey ?? el?.textContent ?? ''
  const trigger = cut && mode === 'popover'
  const Tag = as as ElementType
  const refProps = getReferenceProps({
    className: cx('min-w-0', lines <= 1 && 'block', lines <= 1 && !/\bmax-w-/.test(className ?? '') && 'max-w-full', truncateClass(lines, expanded), trigger && 'cursor-pointer', className),
    // The custom bubble replaces the native one while it is showing.
    title: cut && !open ? text : undefined,
    ...(trigger ? { role: 'button', tabIndex: 0, 'aria-expanded': open } : {}),
  })

  return (
    <>
      <Tag ref={setRef} {...refProps}>{children}</Tag>
      {mode === 'more' && (cut || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          aria-expanded={expanded}
          // A 44px hit area around a text-sized link.
          className="relative block w-fit text-meta font-semibold text-accent-600 after:absolute after:-inset-x-2 after:-inset-y-[14px] after:content-[''] [@media(hover:hover)]:hover:underline"
        >
          {expanded ? 'Less' : 'More'}
        </button>
      )}
      {open && cut && (
        <FloatingPortal root={place.root ?? undefined}>
          <div
            ref={setFloatingEl}
            style={floatingStyles}
            role="tooltip"
            className={cx(BUBBLE, place.tg && 'tg-portal')}
            {...getFloatingProps()}
          >
            {text}
          </div>
        </FloatingPortal>
      )}
    </>
  )
}
