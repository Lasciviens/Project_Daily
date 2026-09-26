import { useState } from 'react'
import { toast } from '../../../../app/store'
import { useRefreshGames } from '../../hooks/useGames'

/**
 * "Refresh library": re-reads every library now. Edits made on this page
 * show at once without it; this is for changes made elsewhere — a push from
 * the handheld, a Steam/PSN import, a scrape on another device.
 */
export function useRefreshLibraryAction() {
  const refresh = useRefreshGames()
  const [busy, setBusy] = useState(false)
  const run = async () => {
    if (busy) return
    setBusy(true)
    try {
      await refresh()
      toast.success('Library refreshed')
    } catch (e) {
      toast.error((e as Error).message ?? 'Could not refresh the library')
    } finally {
      setBusy(false)
    }
  }
  return { run, busy }
}
