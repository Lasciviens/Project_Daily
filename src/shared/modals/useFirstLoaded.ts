import { useState } from 'react'

/**
 * The first loaded value, frozen for the popup's lifetime: a background
 * refetch (window focus, a save elsewhere) must never re-seed a form under
 * the user's fingers.
 */
export function useFirstLoaded<T>(value: T | null | undefined): T | undefined {
  const [snap, setSnap] = useState<T | undefined>(undefined)
  if (snap === undefined && value != null) {
    setSnap(value)
    return value
  }
  return snap
}
