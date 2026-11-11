// ─────────────────────────────────────────────────────────────────────────────
//  The item screen's marks (owner's point 7, answers 4 and 5): a small mark on
//  a row says where that field goes — Apple's logo for Apple Calendar,
//  Google's for Google Calendar and Google Tasks, the app's own logo for "only
//  the app". Shown while Settings → Calendar → "Show where each field goes" is
//  on. A tap (or a mouse resting on it) says it in words; inside a row that is
//  a button, the tap stays with the mark. The red dot means Apple refused it.
// ─────────────────────────────────────────────────────────────────────────────

import { createContext, useCallback, useContext, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import appleMark from '../../../assets/marks/apple.svg'
import googleMark from '../../../assets/marks/google.svg'
import { cx } from '../../ui'
import { FIELD_GOES_TEXT, type FieldGoes } from './itemScreenRules'

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

/**
 * One mark: nothing while the marks are switched off, except `always` (the Calendar row's, owner's point 5).
 * `refused`: Apple didn't take the item (the red dot).
 */
export function FieldMark({ goes, refused, always = false, className }: {
  goes: FieldGoes
  refused?: string | null
  always?: boolean
  className?: string
}) {
  const { show, on } = useContext(BubbleContext)
  if (!on && !always && !refused) return null
  const text = refused ? `${FIELD_GOES_TEXT[goes]}, but it isn't there yet — ${refused}` : FIELD_GOES_TEXT[goes]
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
    return <span aria-hidden className="h-full w-full bg-fg" style={{ maskImage: `url(${appleMark})`, WebkitMaskImage: `url(${appleMark})`, maskSize: 'contain', WebkitMaskSize: 'contain', maskRepeat: 'no-repeat', WebkitMaskRepeat: 'no-repeat' }} />
  }
  return <img src={goes === 'app' ? appMark : googleMark} alt="" aria-hidden className="h-full w-full" draggable={false} />
}
