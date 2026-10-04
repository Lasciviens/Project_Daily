import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useNavigationType, useSearchParams } from 'react-router-dom'
import { useDebouncedValue } from '../../../shared/hooks/useDebouncedValue'
import { whenHistorySettled } from '../../../shared/hooks/useHistoryDismiss'

const SEARCH_STATE = { mediaSearch: true }

/**
 * Media's search session. The box edits LOCAL state (the address is only
 * written after typing settles — a router update per keystroke can drop
 * letters on iOS); `?q=` marks the session, so the results survive a popup,
 * a reload and Back/forward.
 *  - The first letter pushes ONE history entry (tagged in its state); Back,
 *    ✕, Esc or the Overview tab pop exactly that entry — never a second one.
 *  - Deleting every letter ends the session: the overview comes back.
 *  - Leaving the session puts the overview back at the top.
 */
export function useMediaSearchSession() {
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  const navType = useNavigationType()
  const navigate = useNavigate()
  const inSearch = params.has('q')
  const urlQuery = params.get('q') ?? ''
  const [text, setText] = useState(urlQuery)

  // Back/forward or a link brings its own query; our own writes never overwrite typing.
  const [seenKey, setSeenKey] = useState(location.key)
  if (location.key !== seenKey) {
    setSeenKey(location.key)
    if (navType === 'POP' || !inSearch) setText(urlQuery)
  }

  const settled = useDebouncedValue(text, 200)
  useEffect(() => {
    if (!inSearch || settled === urlQuery) return
    setParams(p => { const next = new URLSearchParams(p); next.set('q', settled); return next }, { replace: true, state: location.state })
    // Only a settled change writes; the address itself is read above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settled])

  // Leaving the results: the overview starts at the top, not at the results' scroll depth.
  const was = useRef(inSearch)
  useEffect(() => {
    if (was.current && !inSearch) document.querySelector('[data-app-scroller]')?.scrollTo({ top: 0 })
    was.current = inSearch
  }, [inSearch])

  const change = (v: string) => {
    if (inSearch && !v.trim()) { leave(); return }
    setText(v)
    if (!inSearch && v.trim()) {
      setParams(p => { const next = new URLSearchParams(p); next.set('q', v); return next }, { state: SEARCH_STATE })
    }
  }
  const leave = () => {
    setText('')
    if (!inSearch) return
    if ((location.state as { mediaSearch?: boolean } | null)?.mediaSearch) whenHistorySettled(() => navigate(-1))
    else setParams(p => { const next = new URLSearchParams(p); next.delete('q'); return next }, { replace: true })
  }

  return { text, settled: settled.trim(), pending: settled.trim() !== text.trim(), inSearch, change, leave }
}
