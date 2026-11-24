// ─────────────────────────────────────────────────────────────────────────────
//  The item screen's marks (owner's point 7, answers 4 and 5): where each field
//  goes — Apple's logo for Apple Calendar, Google's for Google Calendar and
//  Google Tasks, the app's own logo for "only the app". Shown while Settings →
//  Calendar → "Show where each field goes" is on.
//  Since 24.11.2026 (owner: "those small images are a bit ugly.. Use them as
//  banner instead. And like a bit shadow. So not fully fully visible") a card's
//  marks are one banner across its top (CardBanner): each place the card's rows
//  go, drawn large, faded and half out of the card, with a soft shadow. Its
//  section title says it in words on a tap (or a mouse resting on it), naming
//  the rows. A mark that is a row's value (the Calendar row's, with the red dot
//  when Apple refused the item) stays small, in its row.
// ─────────────────────────────────────────────────────────────────────────────

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import appleMark from '../../../assets/marks/apple.svg'
import googleMark from '../../../assets/marks/google.svg'
import { cx } from '../../ui'
import { useMotion } from '../../hooks/useMotion'
import { CardContext, MarkRowContext, type CardMark, type RegisterMark } from './cardMarks'
import { cardMarkPlaces, cardMarksText, FIELD_GOES_TEXT, type FieldGoes } from './itemScreenRules'

const appMark = `${import.meta.env.BASE_URL}logo.svg`

interface Bubble { text: string; left: number; top: number }
const BubbleContext = createContext<{ show: (el: HTMLElement, text: string) => void; on: boolean }>({ show: () => undefined, on: false })

/** Holds the one bubble a tapped mark opens, placed over the screen's body (`host` is its positioned box). */
export function MarkHost({ on, children }: { on: boolean; children: ReactNode }) {
  const host = useRef<HTMLDivElement>(null)
  const [bubble, setBubble] = useState<Bubble | null>(null)
  useEffect(() => {
    if (!bubble) return
    const id = window.setTimeout(() => setBubble(null), 2200)
    return () => window.clearTimeout(id)
  }, [bubble])
  const show = useCallback((el: HTMLElement, text: string) => {
    const box = host.current?.getBoundingClientRect()
    const r = el.getBoundingClientRect()
    if (!box) return
    // Kept inside the screen: centred on the mark, at least half its widest (15rem) from either edge.
    const half = Math.min(120, box.width / 2 - 8)
    setBubble({ text, left: Math.min(Math.max(half + 8, r.left - box.left + r.width / 2), box.width - half - 8), top: r.top - box.top })
  }, [])
  return (
    <BubbleContext.Provider value={{ show, on }}>
      <div ref={host} className="relative">
        {children}
        {bubble && (
          <span role="status" style={{ left: bubble.left, top: bubble.top }}
            className="pointer-events-none absolute z-10 w-max max-w-[min(15rem,calc(100%-16px))] -translate-x-1/2 -translate-y-[calc(100%+6px)] whitespace-normal text-center rounded-control bg-fg px-2 py-1 text-meta text-surface shadow-menu motion-pop-in">
            {bubble.text}
          </span>
        )}
      </div>
    </BubbleContext.Provider>
  )
}

/** Inside a card (Section): its rows' marks go to the card's banner instead of their rows. */
export function CardMarksScope({ register, children }: { register: RegisterMark; children: ReactNode }) {
  return <CardContext.Provider value={register}>{children}</CardContext.Provider>
}

/**
 * The card's banner: each place its rows go (cardMarkPlaces), drawn large at the card's top-right and tucked behind
 * it — the card hides its lower part, the rest is faded, with a soft shadow (`.mark-banner` in index.css: tokens only,
 * both themes). It sits in the free space beside the card's title (`titled`) or above an untitled card, never under a
 * row's text or control, and adds no height. A tap (or a mouse resting on it) says where the card's rows go, naming
 * them (cardMarksText).
 */
export function CardBanner({ marks, titled }: { marks: readonly CardMark[]; titled: boolean }) {
  const { show, on } = useContext(BubbleContext)
  const motion = useMotion()
  const places = cardMarkPlaces(marks)
  if (!on || !places.length) return null
  const text = cardMarksText(marks)
  return (
    <button type="button" title={text} aria-label={text} onClick={e => show(e.currentTarget, text)} data-mark-banner=""
      className={cx('mark-banner absolute right-3 -z-10 flex cursor-help gap-1', titled ? '-top-2' : '-top-4', motion && 'motion-pop-in')}>
      {places.map(g => <span key={g} aria-hidden className="mark-banner-art"><MarkIcon goes={g} /></span>)}
    </button>
  )
}

/**
 * One mark: nothing while the marks are switched off, except `always` (the Calendar row's, owner's point 5).
 * `refused`: Apple didn't take the item (the red dot). Inside a card the mark is the card's banner, not the row's —
 * except one that is the row's value (`always`, `refused`), which stays in its row.
 */
export function FieldMark({ goes, refused, always = false, className, row: named }: {
  goes: FieldGoes
  refused?: string | null
  always?: boolean
  className?: string
  /** The row's name where the mark isn't in a row's label (the title, Location, URL, Notes). */
  row?: string
}) {
  const { show, on } = useContext(BubbleContext)
  const register = useContext(CardContext)
  const row = useContext(MarkRowContext) ?? named ?? null
  const id = useId()
  const toCard = !!register && !always && !refused
  useEffect(() => {
    if (!register || !toCard || !on) return
    register(id, { goes, row })
    return () => register(id, null)
  }, [register, toCard, on, id, goes, row])
  if (toCard || (!on && !always && !refused)) return null
  const text = refused ? `${FIELD_GOES_TEXT[goes]} — ${refused}` : FIELD_GOES_TEXT[goes]
  const tap = (e: MouseEvent<HTMLSpanElement>) => { e.stopPropagation(); e.preventDefault(); show(e.currentTarget, text) }
  return (
    <span role="img" aria-label={text} title={text} onClick={tap} className={cx('relative inline-flex h-3.5 w-3.5 shrink-0 cursor-help', className)}>
      <MarkIcon goes={goes} />
      {refused && <span aria-hidden className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-danger ring-2 ring-surface" />}
    </span>
  )
}

/** The picture alone (a list of where things go, the Calendar row's choices). Apple's logo takes the text colour. */
export function MarkIcon({ goes }: { goes: FieldGoes }) {
  if (goes === 'apple') {
    // Quoted: a build inlines the small SVG as a data URI with ' in it, which an unquoted url() can't hold (the mask
    // was dropped and the mark drew as a square).
    const mask = `url("${appleMark}")`
    return <span aria-hidden className="h-full w-full bg-fg" style={{ maskImage: mask, WebkitMaskImage: mask, maskSize: 'contain', WebkitMaskSize: 'contain', maskRepeat: 'no-repeat', WebkitMaskRepeat: 'no-repeat' }} />
  }
  return <img src={goes === 'app' ? appMark : googleMark} alt="" aria-hidden className="h-full w-full" draggable={false} />
}
