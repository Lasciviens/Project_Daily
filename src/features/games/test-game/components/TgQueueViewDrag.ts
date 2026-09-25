import { useEffect, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { flushSync } from 'react-dom'

// Drag-to-reorder for the Play Queue, by a grip handle, with mouse, pen or
// touch (pointer events; the handle is `touch-action: none`, so a finger on it
// drags the row instead of scrolling the page).
//
// Rows are moved by writing `transform` straight onto their elements: a drag
// re-renders nothing until the drop, however long the queue. The dragged row
// follows the pointer; the rows it passes slide out of its way; near the top or
// bottom edge of the scroll container the list scrolls under the finger.

const EDGE = 64 // px from a scroller edge where auto-scroll starts
const MAX_SPEED = 16 // px per frame at the very edge

interface Row { id: string; el: HTMLElement; top: number; height: number }
interface Session {
  pointerId: number
  handle: HTMLElement
  rows: Row[]
  from: number
  to: number
  shift: number
  startY: number
  lastY: number
  startScroll: number
  scroller: HTMLElement | null
  frame: number
}

/** The imperative half: one drag at a time, outside React's render cycle. */
class QueueDrag {
  private s: Session | null = null
  private listRef: RefObject<HTMLElement | null>
  private setDragId: (id: string | null) => void
  private onDrop: (from: number, to: number) => void = () => {}

  constructor(listRef: RefObject<HTMLElement | null>, setDragId: (id: string | null) => void) {
    this.listRef = listRef
    this.setDragId = setDragId
  }

  private layout(s: Session) {
    const scroll = s.scroller?.scrollTop ?? 0
    const dy = s.lastY - s.startY + (scroll - s.startScroll)
    const dragged = s.rows[s.from]
    const centre = dragged.top + dragged.height / 2 + dy
    let to = 0
    s.rows.forEach((r, i) => { if (i !== s.from && r.top + r.height / 2 < centre) to += 1 })
    s.to = to
    s.rows.forEach((r, i) => {
      if (i === s.from) { r.el.style.transform = `translateY(${dy}px)`; return }
      const off = s.from < to && i > s.from && i <= to ? -s.shift : to < s.from && i >= to && i < s.from ? s.shift : 0
      r.el.style.transform = off ? `translateY(${off}px)` : ''
    })
  }

  private tick = () => {
    const s = this.s
    if (!s) return
    const sc = s.scroller
    if (sc) {
      const rect = sc.getBoundingClientRect()
      // The phone scroller runs under the fixed tab bar; its bottom padding says how far.
      const bottom = rect.bottom - parseFloat(getComputedStyle(sc).paddingBottom || '0')
      const top = Math.max(rect.top, 0)
      let v = 0
      if (s.lastY < top + EDGE) v = -MAX_SPEED * Math.min(1, (top + EDGE - s.lastY) / EDGE)
      else if (s.lastY > bottom - EDGE) v = MAX_SPEED * Math.min(1, (s.lastY - (bottom - EDGE)) / EDGE)
      if (v) {
        const before = sc.scrollTop
        sc.scrollTop += v
        if (sc.scrollTop !== before) this.layout(s)
      }
    }
    s.frame = requestAnimationFrame(this.tick)
  }

  private end(commit: boolean) {
    const s = this.s
    if (!s) return
    this.s = null
    cancelAnimationFrame(s.frame)
    if (s.handle.hasPointerCapture(s.pointerId)) s.handle.releasePointerCapture(s.pointerId)
    // Reorder and clear the transforms in the same frame, so nothing jumps.
    flushSync(() => {
      this.setDragId(null)
      if (commit && s.to !== s.from) this.onDrop(s.from, s.to)
    })
    for (const r of s.rows) r.el.style.transform = ''
  }

  start = (e: ReactPointerEvent<HTMLElement>, id: string) => {
    if (this.s || (e.pointerType === 'mouse' && e.button !== 0)) return
    const list = this.listRef.current
    if (!list) return
    const scroller = list.closest<HTMLElement>('.tg-scroll-y')
    const scroll = scroller?.scrollTop ?? 0
    const rows: Row[] = [...list.querySelectorAll<HTMLElement>('[data-queue-id]')].map(el => {
      const r = el.getBoundingClientRect()
      return { id: el.dataset.queueId ?? '', el, top: r.top + scroll, height: r.height }
    })
    const from = rows.findIndex(r => r.id === id)
    if (from === -1 || rows.length < 2) return
    e.preventDefault()
    const handle = e.currentTarget
    handle.setPointerCapture(e.pointerId)
    const cur = rows[from]
    const next = rows[from + 1] ?? rows[from - 1]
    const gap = rows[from + 1] ? next.top - (cur.top + cur.height) : cur.top - (next.top + next.height)
    const s: Session = {
      pointerId: e.pointerId, handle, rows, from, to: from, shift: cur.height + Math.max(0, gap),
      startY: e.clientY, lastY: e.clientY, startScroll: scroll, scroller, frame: 0,
    }
    this.s = s
    this.setDragId(id)

    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== s.pointerId) return
      s.lastY = ev.clientY
      this.layout(s)
    }
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== s.pointerId) return
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      handle.removeEventListener('pointercancel', up)
      this.end(ev.type === 'pointerup')
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
    handle.addEventListener('pointercancel', up)
    s.frame = requestAnimationFrame(this.tick)
  }

  setOnDrop(fn: (from: number, to: number) => void) { this.onDrop = fn }

  /** Unmounting mid-drag (a section switch) must not leave a loop running. */
  dispose() {
    if (this.s) cancelAnimationFrame(this.s.frame)
    this.s = null
  }
}

export function useQueueDrag(listRef: RefObject<HTMLElement | null>, onDrop: (from: number, to: number) => void) {
  const [dragId, setDragId] = useState<string | null>(null)
  const [drag] = useState(() => new QueueDrag(listRef, setDragId))
  useEffect(() => { drag.setOnDrop(onDrop) }, [drag, onDrop])
  useEffect(() => () => drag.dispose(), [drag])
  return { dragId, onPointerDown: drag.start }
}
