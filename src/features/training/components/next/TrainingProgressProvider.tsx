import type { ReactNode } from 'react'
import { useProgressData } from '../../hooks/useProgressData'
import { ProgressDataContext } from '../../progress/progressDataContext'

/** Runs the progress engine ONCE for the tabs that read it (Next, Progress)
 *  and shares the result through ProgressDataContext — every extra
 *  useProgressData() call re-ran the whole engine for every exercise. */
export function TrainingProgressProvider({ children }: { children: ReactNode }) {
  const data = useProgressData()
  return <ProgressDataContext.Provider value={data}>{children}</ProgressDataContext.Provider>
}
