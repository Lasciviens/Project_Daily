import { useState } from 'react'

// Density tokens (DENSITY PILOT — see DensityControl.tsx for the UI and
// index.css for the CSS vars each mode sets). Separate file so the component
// file only exports components (react-refresh rule).

export type Density = 'comfortable' | 'compact' | 'dense'

export const DENSITY_CLASS: Record<Density, string> = {
  comfortable: '',
  compact:     'dz-compact',
  dense:       'dz-dense',
}

export function useDensity(storageKey: string): [Density, (d: Density) => void] {
  const [density, setDensity] = useState<Density>(() => {
    const raw = localStorage.getItem(storageKey)
    return raw === 'compact' || raw === 'dense' ? raw : 'comfortable'
  })
  return [density, (d: Density) => { setDensity(d); localStorage.setItem(storageKey, d) }]
}
