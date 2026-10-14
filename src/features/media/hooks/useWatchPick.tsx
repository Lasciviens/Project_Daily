import { useCallback, useRef, useState } from 'react'
import { WatchPickSheet, type WatchPickAnswer, type WatchPickAsk } from '../components/WatchPickSheet'

/** `ask` opens "Which watch gets the new date?" and resolves the answer (null = cancelled); render `dialog`. */
export function useWatchPick() {
  const [state, setState] = useState<WatchPickAsk | null>(null)
  const resolver = useRef<((a: WatchPickAnswer | null) => void) | null>(null)
  const ask = useCallback((a: WatchPickAsk) => new Promise<WatchPickAnswer | null>(resolve => {
    resolver.current = resolve
    setState(a)
  }), [])
  const onDone = (a: WatchPickAnswer | null) => {
    resolver.current?.(a)
    resolver.current = null
    setState(null)
  }
  const dialog = state ? <WatchPickSheet ask={state} onDone={onDone} /> : null
  return { ask, dialog }
}
