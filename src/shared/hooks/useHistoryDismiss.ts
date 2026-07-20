import { useEffect } from 'react'

/**
 * Native "Back closes the overlay" (#6). While `open`, pushes a throwaway
 * history entry so the hardware / browser Back button — and the iOS edge-swipe
 * back gesture — pops it and fires `onClose` instead of navigating the app away.
 * Closing by any other means (X / backdrop / unmount) rolls our entry back so
 * the history stack stays balanced and a subsequent real Back still works.
 */
export function useHistoryDismiss(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open || typeof window === 'undefined') return
    window.history.pushState({ __overlay: true }, '')
    const onPop = () => onClose()
    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
      // Closed WITHOUT a Back nav (X/backdrop/unmount) → pop our own entry.
      // A real Back already popped it (state is no longer ours), so the guard
      // prevents a double-back.
      if (window.history.state && (window.history.state as { __overlay?: boolean }).__overlay) {
        window.history.back()
      }
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
}
