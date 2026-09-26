import { useEffect, useRef } from 'react'

// Overlays open right now, bottom to top. Only the TOP one reacts to a Back:
// with a sheet opened over a review, one Back closes the sheet and leaves the
// review alone (before, every open overlay's listener closed on every pop).
const stack: number[] = []
let nextId = 0
// history.back() calls made to drop our OWN entry when an overlay closes by
// other means (X, Save, unmount). Their popstate must not close anything else.
let ownPops = 0
let suppressed = false
// Overlays waiting to push their entry until our own pending pops have landed.
// history.back() is asynchronous: pushing in the same moment (a sheet closing
// as the dialog it launched opens) left the new overlay with no entry of its
// own, so the next Back left the page instead of closing it.
const deferred: (() => void)[] = []

function flushDeferred() {
  while (deferred.length && ownPops === 0) deferred.shift()!()
}

// Registered once, before any overlay's listener, so it runs first in every
// popstate dispatch and tells the overlays whether this pop was ours.
if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    suppressed = ownPops > 0
    if (suppressed) ownPops--
    if (ownPops === 0) flushDeferred()
  })
}

/**
 * Native "Back closes the overlay" (#6). While `open`, pushes a throwaway
 * history entry so the hardware / browser Back button — and the iOS edge-swipe
 * back gesture — pops it and fires `onClose` instead of navigating the app away.
 * Closing by any other means (X / backdrop / unmount) rolls our entry back so
 * the history stack stays balanced and a subsequent real Back still works —
 * and that roll-back is never mistaken for a Back by the overlay underneath
 * (or by one that opens in the same moment, e.g. "Open the game" after a save).
 */
export function useHistoryDismiss(open: boolean, onClose: () => void) {
  const close = useRef(onClose)
  useEffect(() => { close.current = onClose })

  useEffect(() => {
    if (!open || typeof window === 'undefined') return
    const id = ++nextId
    let pushed = false
    const push = () => {
      window.history.pushState({ __overlay: id }, '')
      pushed = true
    }
    stack.push(id)
    let fallback = 0
    if (ownPops > 0) {
      deferred.push(push)
      // If the pending pop never arrives (nothing to go back to), push anyway.
      fallback = window.setTimeout(() => {
        const at = deferred.indexOf(push)
        if (at !== -1) { deferred.splice(at, 1); push() }
      }, 400)
    } else {
      push()
    }

    const onPop = () => {
      if (suppressed || !pushed) return
      if (stack[stack.length - 1] !== id) return // not the top overlay
      stack.pop()
      close.current()
    }
    window.addEventListener('popstate', onPop)

    return () => {
      window.clearTimeout(fallback)
      window.removeEventListener('popstate', onPop)
      const waiting = deferred.indexOf(push)
      if (waiting !== -1) deferred.splice(waiting, 1)
      const at = stack.indexOf(id)
      if (at === -1) return // a real Back already popped our entry
      stack.splice(at, 1)
      // Closed WITHOUT a Back nav: drop our own entry if it is the current one.
      // (Buried under a newer overlay's entry, it is left for a later Back.)
      const state = window.history.state as { __overlay?: number } | null
      if (pushed && state?.__overlay === id) {
        ownPops++
        window.history.back()
      }
    }
  }, [open])
}
