import { useCallback, useRef, useState } from 'react'
import { WatchedWhenSheet, type WatchedWhenAsk } from '../components/WatchedWhenSheet'
import type { WatchedWhen } from '../watchedWhen'

/** `ask` opens the "when did you watch it?" sheet and resolves the answer (null = cancelled); render `dialog`. */
export function useWatchedWhenPrompt() {
  const [state, setState] = useState<WatchedWhenAsk | null>(null)
  const resolver = useRef<((w: WatchedWhen | null) => void) | null>(null)
  const ask = useCallback((a: WatchedWhenAsk) => new Promise<WatchedWhen | null>(resolve => {
    resolver.current = resolve
    setState(a)
  }), [])
  const onDone = (w: WatchedWhen | null) => {
    resolver.current?.(w)
    resolver.current = null
    setState(null)
  }
  const dialog = state ? <WatchedWhenSheet key={state.title} ask={state} onDone={onDone} /> : null
  return { ask, dialog }
}
