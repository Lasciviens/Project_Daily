import { createContext, useContext } from 'react'
import type { ProgressData } from '../hooks/useProgressData'

// The Progress page runs the decision engine ONCE (ProgressTab calls
// useProgressData and provides the result here); every card reads it from
// context instead of calling the hook again — each extra call re-ran the
// whole engine for every exercise.
export const ProgressDataContext = createContext<ProgressData | null>(null)

export function useProgressDataContext(): ProgressData {
  const data = useContext(ProgressDataContext)
  if (!data) throw new Error('useProgressDataContext must be used inside ProgressDataContext.Provider (ProgressTab)')
  return data
}
