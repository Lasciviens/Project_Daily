import { useEffect, useMemo, useReducer, useRef, useState, type ElementType, type ReactNode } from 'react'
import { useTruncatedElement } from '../hooks/useIsTruncated'
import { TAPPABLE_SELECTOR, revealModeFor, truncateClass, type RevealMode, type TruncateLines, type TruncateReveal } from './truncateRules'
import { TruncateBubble } from './TruncateBubble'
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

const HOVER_OPEN_MS = 400
const HOVER_CLOSE_MS = 80
const HEADINGS = new Set<TruncateTag>(['h2', 'h3', 'h4'])

type OpenedBy = '' | 'hover' | 'click'

/** Our own trigger span must not count as "a control inside the text". */
const OWN_TRIGGER = 'data-truncate-trigger'

/** The element's text as read aloud: aria-hidden parts (an icon's emoji, a
 *  count-up's width placeholder) are not part of the full text. */
function spokenText(el: HTMLElement): string {
  let out = ''
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const hidden = n.parentElement?.closest('[aria-hidden="true"]')
    if (hidden && hidden !== el && el.contains(hidden)) continue
    out += n.textContent ?? ''
  }
  return out.replace(/\s+/g, ' ').trim()
}

function readPlace(el: HTMLElement) {
  const inner = [...el.querySelectorAll(TAPPABLE_SELECTOR)].some(n => !n.hasAttribute(OWN_TRIGGER))
  return {
    // A control around the text (a row) or inside it (an ⓘ in a title) rules out a trigger.
    tappable: !!el.parentElement?.closest(TAPPABLE_SELECTOR) || inner,
    // /games draws with its own tokens: the page itself, or one of its
    // portalled menus and dialogs (they carry `tg-portal`, outside `.tg-root`).
    tg: !!el.closest('.tg-root, .tg-portal'),
  }
}

/**
 * Text that stops at its box and reveals the rest only when it is really cut
 * (THEME.md §5): always a `title`; a mouse tooltip after 400ms; outside a
 * tappable element a tap / click / Enter opens a bubble with the full text
 * (one line) or an in-place "More" expands it (2–3 lines). Inside a tappable
 * row nothing extra happens on touch — the row itself opens the item.
 * Screen readers always read the full text: CSS truncation removes nothing.
 *
 * Cheap by design (the Games grid renders ~1,500 of these): text that fits is
 * one element, one render and no listeners; the listeners attach only while
 * the text is cut, and the positioned bubble mounts only while it is open.
 */
export function Truncate({ children, lines = 1, as = 'span', className, reveal = 'auto', fullText }: TruncateProps) {
  const ref = useRef<HTMLElement>(null)
  const [open, setOpenState] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const plain = typeof children === 'string' || typeof children === 'number' ? String(children) : undefined
  const textKey = fullText ?? plain
  const cutEl = useTruncatedElement(ref, lines, textKey, as)
  const cut = cutEl != null
  // Rich children (a count-up next to a label) change without re-rendering
  // this component, so their text is re-read when a pointer or focus arrives.
  const [, reread] = useReducer((n: number) => n + 1, 0)
  const place = useMemo(() => (cutEl ? readPlace(cutEl) : null), [cutEl])
  const mode: RevealMode = revealModeFor({ lines, reveal, insideTappable: place?.tappable ?? true })

  // Open state + who opened it + hover timers, shared with the DOM listeners.
  // One stable controller: no per-render callbacks or effects.
  const [ctl] = useState(() => {
    const l = { open: false, by: '' as OpenedBy, openTimer: 0, closeTimer: 0 }
    const set = (next: boolean, by: OpenedBy = '') => {
      window.clearTimeout(l.openTimer); window.clearTimeout(l.closeTimer)
      l.open = next
      l.by = next ? (l.by === 'click' ? 'click' : by) : ''
      setOpenState(next)
    }
    return {
      l, set,
      scheduleClose: () => {
        if (!l.open || l.by === 'click') return
        window.clearTimeout(l.closeTimer)
        l.closeTimer = window.setTimeout(() => set(false), HOVER_CLOSE_MS)
      },
      cancelClose: () => window.clearTimeout(l.closeTimer),
      close: () => set(false),
    }
  })

  // Mouse hover (both bubble modes), tap / click / Enter (popover), and a
  // press on a row closing its tooltip so it never lingers over the popup.
  useEffect(() => {
    if (!cutEl || mode === 'more') return
    const { l, set } = ctl
    const enter = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return
      window.clearTimeout(l.closeTimer)
      if (l.open) return
      l.openTimer = window.setTimeout(() => set(true, 'hover'), HOVER_OPEN_MS)
    }
    const leave = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || l.by === 'click') { window.clearTimeout(l.openTimer); return }
      window.clearTimeout(l.openTimer)
      if (l.open) l.closeTimer = window.setTimeout(() => set(false), HOVER_CLOSE_MS)
    }
    const press = () => { if (mode === 'hover') set(false) }
    const click = () => {
      if (mode !== 'popover') return
      // A click on a tooltip the mouse already opened keeps it (now pinned).
      if (l.open && l.by === 'hover') { l.by = 'click'; return }
      set(!l.open, 'click')
    }
    const key = (e: KeyboardEvent) => {
      if (mode !== 'popover' || (e.key !== 'Enter' && e.key !== ' ')) return
      if (!(e.target as HTMLElement).hasAttribute(OWN_TRIGGER)) return
      e.preventDefault()
      set(!l.open, 'click')
    }
    const fresh = () => { if (textKey == null) reread() }
    cutEl.addEventListener('pointerenter', fresh)
    cutEl.addEventListener('focusin', fresh)
    cutEl.addEventListener('pointerenter', enter)
    cutEl.addEventListener('pointerleave', leave)
    cutEl.addEventListener('pointerdown', press)
    cutEl.addEventListener('click', click)
    cutEl.addEventListener('keydown', key)
    return () => {
      cutEl.removeEventListener('pointerenter', enter)
      cutEl.removeEventListener('pointerleave', leave)
      cutEl.removeEventListener('pointerdown', press)
      cutEl.removeEventListener('click', click)
      cutEl.removeEventListener('keydown', key)
      cutEl.removeEventListener('pointerenter', fresh)
      cutEl.removeEventListener('focusin', fresh)
      // The text fits again (or the element went): nothing stays open or pending.
      window.clearTimeout(l.openTimer); window.clearTimeout(l.closeTimer)
      if (l.open) set(false)
    }
  }, [cutEl, mode, ctl, textKey])

  const showing = open && cut && mode !== 'more'
  const text = textKey ?? (cutEl ? spokenText(cutEl) : '')
  const trigger = cut && mode === 'popover'
  // A heading keeps its role: the button role goes on a span inside it.
  const innerTrigger = trigger && HEADINGS.has(as)
  const triggerProps = trigger ? { role: 'button', tabIndex: 0, 'aria-expanded': showing, [OWN_TRIGGER]: '' } : {}
  const Tag = as as ElementType

  return (
    <>
      <Tag
        ref={ref}
        className={cx('min-w-0', lines <= 1 && 'block', lines <= 1 && !/\bmax-w-/.test(className ?? '') && 'max-w-full', truncateClass(lines, expanded), trigger && 'cursor-pointer', className)}
        // The custom bubble replaces the native one while it is showing.
        title={cut && !showing ? text : undefined}
        {...(innerTrigger ? {} : triggerProps)}
      >
        {innerTrigger ? <span {...triggerProps}>{children}</span> : children}
      </Tag>
      {mode === 'more' && (cut || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          aria-expanded={expanded}
          // A hook for pages with their own palette (/games colours it).
          data-truncate-more=""
          // A 44px hit area around a text-sized link.
          className="relative block w-fit text-meta font-semibold text-accent-600 after:absolute after:-inset-x-2 after:-inset-y-[14px] after:content-[''] [@media(hover:hover)]:hover:underline"
        >
          {expanded ? 'Less' : 'More'}
        </button>
      )}
      {showing && cutEl && (
        <TruncateBubble
          reference={cutEl}
          text={text}
          tg={place?.tg ?? false}
          onPointerEnter={ctl.cancelClose}
          onPointerLeave={ctl.scheduleClose}
          onDismiss={ctl.close}
        />
      )}
    </>
  )
}
