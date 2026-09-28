import { useEffect, useRef, type RefObject } from 'react'
import { isRequestUi, labelFor, pickTarget, widerTarget } from './pickDom'

// Pointing at something on the page while writing a request.
//
// No overlay element: listeners on `window` in the CAPTURE phase see every
// pointer event before the page does, so the click that picks is swallowed
// (preventDefault + stopImmediatePropagation) before any button, link, drawer
// backdrop or Headless UI outside-click handler runs — the page stays exactly
// as it was, open popups included. Hover still works (the highlight follows
// the real element under the pointer, :hover styles included) and scrolling is
// never touched, so a phone can scroll to the thing it wants.
//
//   'pick'  every click/tap picks; Esc stops; ↑/↓ widen/narrow the hovered target
//   'alt'   the page works normally; only an Alt-click picks (desktop)
//   'off'   nothing
//
// Touch screens pick in two steps: a tap selects (the caller shows it with
// Wider / Use this), since a fingertip rarely lands on exactly the right box.

export type PickModeKind = 'off' | 'alt' | 'pick'

interface Options {
  mode: PickModeKind
  /** Tap selects a candidate instead of capturing at once. */
  twoStep: boolean
  onCapture: (el: Element) => void
  onCandidate?: (el: Element | null) => void
  onCancel?: () => void
  boxRef: RefObject<HTMLDivElement | null>
  labelRef: RefObject<HTMLSpanElement | null>
}

const BLOCKED = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'dblclick', 'auxclick', 'contextmenu'] as const
// Stopped (so no page handler runs) but never prevented: preventing a touch
// event would cancel scrolling or the click that follows.
const STOPPED = ['touchstart', 'touchend'] as const

const isTextEntry = (t: EventTarget | null) =>
  t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || (t instanceof HTMLElement && t.isContentEditable)
  || (t instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'submit', 'range'].includes(t.type))

export function usePickMode({ mode, twoStep, onCapture, onCandidate, onCancel, boxRef, labelRef }: Options) {
  const cb = useRef({ onCapture, onCandidate, onCancel })
  useEffect(() => { cb.current = { onCapture, onCandidate, onCancel } })
  const api = useRef<{ widen: () => void; narrow: () => void; current: () => Element | null }>({
    widen: () => {}, narrow: () => {}, current: () => null,
  })

  useEffect(() => {
    if (mode === 'off') return
    let base: Element | null = null
    let depth = 0
    let current: Element | null = null
    let raf = 0
    const boxEl = boxRef.current

    const paint = () => {
      raf = 0
      const box = boxRef.current
      if (!box) return
      if (!current || !current.isConnected) { box.style.display = 'none'; return }
      const r = current.getBoundingClientRect()
      box.style.display = 'block'
      box.style.left = `${r.left - 2}px`
      box.style.top = `${r.top - 2}px`
      box.style.width = `${r.width + 4}px`
      box.style.height = `${r.height + 4}px`
      const label = labelRef.current
      if (label) {
        label.textContent = labelFor(current)
        label.dataset.below = r.top < 28 ? 'true' : 'false'
      }
    }
    const schedule = () => { if (!raf) raf = requestAnimationFrame(paint) }
    const resolve = (): Element | null => {
      if (!base) return null
      let el: Element = pickTarget(base)
      for (let i = 0; i < depth; i++) el = widerTarget(el) ?? el
      return el
    }
    const show = (el: Element | null) => { current = el; schedule() }
    const aim = (t: Element) => { if (t !== base) { base = t; depth = 0 } }

    const altOk = (e: Event) => mode === 'pick' || (e as MouseEvent).altKey === true
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return
      const t = e.target
      if (!(t instanceof Element) || isRequestUi(t) || !altOk(e)) { if (!twoStep || mode === 'alt') show(null); return }
      if (twoStep) return
      aim(t)
      show(resolve())
    }
    const block = (e: Event) => {
      if (isRequestUi(e.target) || !altOk(e)) return
      e.preventDefault()
      e.stopImmediatePropagation()
    }
    const stop = (e: Event) => {
      if (mode !== 'pick' || isRequestUi(e.target)) return
      e.stopImmediatePropagation()
    }
    const onClick = (e: MouseEvent) => {
      const t = e.target
      if (!(t instanceof Element) || isRequestUi(t) || !altOk(e)) return
      e.preventDefault()
      e.stopImmediatePropagation()
      aim(t)
      const el = resolve() ?? t
      if (twoStep && mode === 'pick') { show(el); cb.current.onCandidate?.(el); return }
      show(null)
      cb.current.onCapture(el)
    }
    const onKey = (e: KeyboardEvent) => {
      if (mode !== 'pick') return
      if (e.key === 'Escape') {
        e.preventDefault(); e.stopImmediatePropagation()
        cb.current.onCancel?.()
      } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && current && !isTextEntry(e.target)) {
        e.preventDefault(); e.stopImmediatePropagation()
        if (e.key === 'ArrowUp') api.current.widen(); else api.current.narrow()
      }
    }
    // Alt released: the Alt-click highlight goes away.
    const onKeyUp = (e: KeyboardEvent) => { if (mode === 'alt' && e.key === 'Alt') show(null) }

    api.current = {
      widen: () => { if (!current) return; const w = widerTarget(current); if (w) { depth++; show(w); cb.current.onCandidate?.(w) } },
      narrow: () => { if (depth === 0) return; depth--; const el = resolve(); show(el); cb.current.onCandidate?.(el) },
      current: () => current,
    }

    const opts = { capture: true } as const
    window.addEventListener('pointermove', onMove, { capture: true, passive: true })
    for (const t of BLOCKED) window.addEventListener(t, block, opts)
    for (const t of STOPPED) window.addEventListener(t, stop, opts)
    window.addEventListener('click', onClick, opts)
    window.addEventListener('keydown', onKey, opts)
    window.addEventListener('keyup', onKeyUp, opts)
    window.addEventListener('scroll', schedule, { capture: true, passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      window.removeEventListener('pointermove', onMove, opts)
      for (const t of BLOCKED) window.removeEventListener(t, block, opts)
      for (const t of STOPPED) window.removeEventListener(t, stop, opts)
      window.removeEventListener('click', onClick, opts)
      window.removeEventListener('keydown', onKey, opts)
      window.removeEventListener('keyup', onKeyUp, opts)
      window.removeEventListener('scroll', schedule, opts)
      window.removeEventListener('resize', schedule)
      if (raf) cancelAnimationFrame(raf)
      if (boxEl) boxEl.style.display = 'none'
      api.current = { widen: () => {}, narrow: () => {}, current: () => null }
    }
  }, [mode, twoStep, boxRef, labelRef])

  return api
}
