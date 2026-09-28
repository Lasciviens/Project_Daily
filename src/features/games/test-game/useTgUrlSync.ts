import { useEffect, useLayoutEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTestGameStore } from './testGameStore'
import { STATUS_SECTIONS, tgStateFromUrl, tgUrlFromState } from './testGameModel'

/**
 * Keeps the open section and platform in the address (`?section=&platform=`,
 * the Health/Training way): a link can open the Play Queue or a platform
 * shelf directly, and a reload or Back lands on the same view. The page store
 * stays the source of truth every control writes to; this mirrors it both ways.
 *
 * - Address → store, whenever the address changes (a link, Back/Forward). A
 *   plain /games names nothing, so the page stays where it was last.
 * - Store → address, whenever the section or platform changes (replacing the
 *   history entry, like Training's tabs). Read from getState(), not the
 *   render: on the first commit the address step above has already moved the
 *   store, and the render's stale values would overwrite the link.
 */
export function useTgUrlSync(): void {
  const [params, setParams] = useSearchParams()
  const section = useTestGameStore(s => s.section)
  const platform = useTestGameStore(s => s.platform)
  const scopePlatform = useTestGameStore(s => s.scopePlatform)
  const applied = useRef<string | null>(null)

  const query = params.toString()
  useLayoutEffect(() => {
    if (applied.current === query) return
    applied.current = query
    const want = tgStateFromUrl(params.get('section'), params.get('platform'))
    if (!want) return
    const s = useTestGameStore.getState()
    if (want.section === 'library') {
      if (s.section !== 'library' || s.platform !== want.platform) s.setPlatform(want.platform)
      return
    }
    if (s.section !== want.section) s.setSection(want.section)
    if (STATUS_SECTIONS[want.section] && useTestGameStore.getState().scopePlatform !== want.platform) s.setScopePlatform(want.platform)
  }, [query]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const s = useTestGameStore.getState()
    const want = tgUrlFromState(s.section, s.platform, s.scopePlatform)
    if (params.get('section') === want.section && params.get('platform') === want.platform) return
    setParams(p => {
      const n = new URLSearchParams(p)
      if (want.section) n.set('section', want.section); else n.delete('section')
      if (want.platform) n.set('platform', want.platform); else n.delete('platform')
      return n
    }, { replace: true })
  }, [section, platform, scopePlatform, params, setParams])
}
