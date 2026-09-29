import { useEffect, useState, useSyncExternalStore } from 'react'
import { readSelection } from '../pick/pickDom'

/** Live `matchMedia(query).matches`. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const m = window.matchMedia(query)
      m.addEventListener('change', onChange)
      return () => m.removeEventListener('change', onChange)
    },
    () => window.matchMedia(query).matches,
    () => false,
  )
}

/**
 * Puts keyboard focus into the composer and keeps it there while whatever
 * just closed hands focus back to its own trigger. Opening the composer from
 * the Requests drawer closes the drawer in the same tap, and Headless UI then
 * restores focus to the top bar's Requests button a few frames later — so a
 * plain autoFocus lost the caret, the next space pressed that button and the
 * rest of the typing went nowhere. For a short while focus that lands outside
 * the composer is taken back (to the field the user last used in it, else
 * `target`); a press outside the composer ends it at once, since that is the
 * user choosing where to go. `onEnd` runs when it is over (the window
 * elapsed, or that press) — not when cancelled. Returns the cancel function.
 */
export function focusIntoComposer(root: () => HTMLElement | null, target: () => HTMLElement | null, onEnd?: () => void, windowMs = 900): () => void {
  let stopped = false
  let last: HTMLElement | null = null
  const timers: ReturnType<typeof setTimeout>[] = []
  const inside = (n: EventTarget | null) => n instanceof Node && !!root()?.contains(n)

  const attempt = () => {
    if (stopped) return
    const r = root()
    if (!r) return
    const active = document.activeElement
    if (inside(active)) { last = active as HTMLElement; return }
    // Back to where the user was typing (a text box keeps its caret); the
    // first time, the target with the caret after any text already there.
    if (last?.isConnected) { last.focus({ preventScroll: true }); return }
    const el = target() ?? r
    el.focus({ preventScroll: true })
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      const end = el.value.length
      try { el.setSelectionRange(end, end) } catch { /* not a text type */ }
    }
  }
  const onFocusIn = (e: FocusEvent) => {
    if (inside(e.target)) { last = e.target as HTMLElement; return }
    queueMicrotask(attempt)
  }
  const onPointerDown = (e: PointerEvent) => { if (!inside(e.target)) stop(true) }
  function stop(ended = false) {
    if (stopped) return
    stopped = true
    timers.forEach(clearTimeout)
    document.removeEventListener('focusin', onFocusIn, true)
    document.removeEventListener('pointerdown', onPointerDown, true)
    if (ended) onEnd?.()
  }

  document.addEventListener('focusin', onFocusIn, true)
  document.addEventListener('pointerdown', onPointerDown, true)
  attempt()
  for (const ms of [50, 150, 300, 500]) timers.push(setTimeout(attempt, ms))
  timers.push(setTimeout(() => stop(true), windowMs))
  return () => stop()
}

/**
 * The last text the user selected on the page (outside the composer), kept
 * for a few seconds after it is cleared — on a phone, tapping the Quote
 * button clears the selection before the tap lands.
 */
export function useSelectionSnapshot(enabled: boolean) {
  const [snap, setSnap] = useState<{ text: string; element: Element } | null>(null)
  useEffect(() => {
    if (!enabled) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const onChange = () => {
      const s = readSelection()
      if (s) {
        clearTimeout(timer)
        setSnap(prev => (prev && prev.text === s.text && prev.element === s.element ? prev : s))
      } else {
        clearTimeout(timer)
        timer = setTimeout(() => setSnap(null), 8000)
      }
    }
    onChange()
    document.addEventListener('selectionchange', onChange)
    return () => { document.removeEventListener('selectionchange', onChange); clearTimeout(timer) }
  }, [enabled])
  return snap ? { ...snap, clear: () => setSnap(null) } : null
}
