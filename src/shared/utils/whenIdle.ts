import type { QueryClient } from '@tanstack/react-query'

/**
 * Runs `run` at the browser's next quiet moment (requestIdleCallback, at the
 * latest after `timeout` ms). Safari has none, so a timer stands in there.
 * Returns the cancel. Only whenSettled calls it: on its own, on the iPhone, it
 * ran at a fixed 1.5 s, while the open page was still reading its data.
 */
function whenIdle(run: () => void, timeout = 4000): () => void {
  if ('requestIdleCallback' in window) {
    const id = window.requestIdleCallback(run, { timeout })
    return () => window.cancelIdleCallback(id)
  }
  const id = setTimeout(run, 1500)
  return () => clearTimeout(id)
}

// How long no query may be loading before the page counts as drawn: reads
// that depend on others start a moment after the first ones answer.
const QUIET_MS = 500

/**
 * Runs `run` once the open page has its data — no query loading for a moment —
 * at the browser's next quiet moment after that (whenIdle); at the latest
 * after `maxWaitMs`, for a page that keeps reading. Background work (other
 * pages' code) started earlier competed with the page's own first render.
 * Returns the cancel.
 */
export function whenSettled(qc: QueryClient, run: () => void, maxWaitMs = 10_000): () => void {
  let cancelIdle: (() => void) | null = null
  let quiet: ReturnType<typeof setTimeout> | null = null
  let started = false
  const stopWatching = () => {
    unsubscribe()
    clearTimeout(timer)
    if (quiet) clearTimeout(quiet)
  }
  const start = () => {
    if (started) return
    started = true
    stopWatching()
    cancelIdle = whenIdle(run)
  }
  const check = () => {
    if (qc.isFetching() > 0) {
      if (quiet) { clearTimeout(quiet); quiet = null }
    } else if (!quiet) {
      quiet = setTimeout(start, QUIET_MS)
    }
  }
  const unsubscribe = qc.getQueryCache().subscribe(check)
  const timer = setTimeout(start, maxWaitMs)
  check()
  return () => {
    started = true
    stopWatching()
    cancelIdle?.()
  }
}
