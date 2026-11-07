/**
 * Runs `run` at the browser's next quiet moment (requestIdleCallback, at the
 * latest after `timeout` ms). Safari has none, so a timer stands in there.
 * Returns the cancel, ready for an effect's cleanup.
 */
export function whenIdle(run: () => void, timeout = 4000): () => void {
  if ('requestIdleCallback' in window) {
    const id = window.requestIdleCallback(run, { timeout })
    return () => window.cancelIdleCallback(id)
  }
  const id = setTimeout(run, 1500)
  return () => clearTimeout(id)
}
