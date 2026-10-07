import { useCallback, useRef, useState } from 'react'
import { PlaysSheet, type PlaysAnswer, type PlaysAsk } from '../components/PlaysSheet'

/** `ask` opens the "plays and date" sheet and resolves the answer (null = cancelled); render `dialog`. */
export function usePlaysPrompt() {
  const [state, setState] = useState<PlaysAsk | null>(null)
  const resolver = useRef<((a: PlaysAnswer | null) => void) | null>(null)
  const ask = useCallback((a: PlaysAsk) => new Promise<PlaysAnswer | null>(resolve => {
    resolver.current = resolve
    setState(a)
  }), [])
  const onDone = (a: PlaysAnswer | null) => {
    resolver.current?.(a)
    resolver.current = null
    setState(null)
  }
  const dialog = state ? <PlaysSheet key={state.title} ask={state} onDone={onDone} /> : null
  return { ask, dialog }
}
