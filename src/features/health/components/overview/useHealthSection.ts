import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { DEFAULT_HEALTH_SECTION, parseHealthSection, type HealthSectionId } from '../sectionTypes'

/** The open Health window, in `?section=` (the default leaves the URL clean).
 *  A functional update, so the date/period params next to it are kept; it
 *  replaces the history entry like Training's tabs do. */
export function useHealthSection(): [HealthSectionId, (id: HealthSectionId) => void] {
  const [params, setParams] = useSearchParams()
  const section = parseHealthSection(params.get('section'))
  const setSection = useCallback((id: HealthSectionId) => {
    setParams(p => {
      const n = new URLSearchParams(p)
      if (id === DEFAULT_HEALTH_SECTION) n.delete('section'); else n.set('section', id)
      return n
    }, { replace: true })
  }, [setParams])
  return [section, setSection]
}
