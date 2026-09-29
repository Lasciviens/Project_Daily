import { useEffect, useLayoutEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { whenHistorySettled } from '../../../shared/hooks/useHistoryDismiss'
import { useTestGameStore } from './testGameStore'
import { STATUS_SECTIONS, tgStateFromUrl, tgUrlFromState } from './testGameModel'

/** The query of the address as it is right now (HashRouter: after the `?` in the hash). */
function liveQuery(): URLSearchParams {
  const hash = window.location.hash
  const at = hash.indexOf('?')
  return new URLSearchParams(at === -1 ? '' : hash.slice(at + 1))
}

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
 * - The write waits until the history is back on the page's own entry
 *   (whenHistorySettled). A pick that also closes a popup (the phone's
 *   platform sheet, an Analytics drill, Scrape from a detail) used to replace
 *   the popup's throwaway entry; the popup's own Back then landed on the old
 *   address, which stayed stale — or, when the Back was slow, was applied and
 *   undid the pick. The address is read live when the write runs, not from
 *   the render it was queued in.
 */
export function useTgUrlSync(): void {
  const [params, setParams] = useSearchParams()
  const section = useTestGameStore(s => s.section)
  const platform = useTestGameStore(s => s.platform)
  const scopePlatform = useTestGameStore(s => s.scopePlatform)
  const applied = useRef<string | null>(null)
  const pending = useRef<(() => void) | null>(null)

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
    pending.current?.()
    pending.current = whenHistorySettled(() => {
      pending.current = null
      if (!/^#\/games(\?|$)/.test(window.location.hash)) return
      const s = useTestGameStore.getState()
      const want = tgUrlFromState(s.section, s.platform, s.scopePlatform)
      const next = liveQuery()
      if (next.get('section') === want.section && next.get('platform') === want.platform) return
      if (want.section) next.set('section', want.section); else next.delete('section')
      if (want.platform) next.set('platform', want.platform); else next.delete('platform')
      setParams(next, { replace: true })
    })
  }, [section, platform, scopePlatform, params, setParams])

  // Leaving the page drops a write still waiting for a popup's Back.
  useEffect(() => () => pending.current?.(), [])
}
