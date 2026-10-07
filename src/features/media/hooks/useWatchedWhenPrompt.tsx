import { useCallback, useRef, useState } from 'react'
import { WatchedWhenSheet, type WatchedWhenAnswer, type WatchedWhenAsk } from '../components/WatchedWhenSheet'
import type { WatchedWhen } from '../watchedWhen'

/**
 * `ask` opens the "when did you watch it?" sheet and resolves the answer
 * (null = cancelled); `askSeries` also offers "Spread over dates…" and can
 * resolve `{ kind: 'spread' }`. Render `dialog`.
 */
export function useWatchedWhenPrompt() {
  const [state, setState] = useState<WatchedWhenAsk | null>(null)
  const resolver = useRef<((w: WatchedWhenAnswer | null) => void) | null>(null)
  const askSeries = useCallback((a: Omit<WatchedWhenAsk, 'allowSpread'>) => new Promise<WatchedWhenAnswer | null>(resolve => {
    resolver.current = resolve
    setState({ ...a, allowSpread: true })
  }), [])
  const ask = useCallback((a: Omit<WatchedWhenAsk, 'allowSpread'>) => new Promise<WatchedWhen | null>(resolve => {
    resolver.current = w => resolve(w && w.kind !== 'spread' ? w : null)
    setState(a)
  }), [])
  const onDone = (w: WatchedWhenAnswer | null) => {
    resolver.current?.(w)
    resolver.current = null
    setState(null)
  }
  const dialog = state ? <WatchedWhenSheet key={state.title} ask={state} onDone={onDone} /> : null
  return { ask, askSeries, dialog }
}
