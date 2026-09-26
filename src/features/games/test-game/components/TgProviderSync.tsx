import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from '../../../../app/store'
import { logError } from '../../../../shared/utils/logError'
import { fetchSteamOwnedGames } from '../../api/steamApi'
import { fetchPsnPlayedGames } from '../../api/psnApi'
import { importProviderGames } from '../../api/gamesApi'
import { psnImportRows, steamImportRows } from '../../api/providerImportRows'
import { formatDay, type TgGame } from '../testGameModel'
import { lastSynced } from './tgProviderSync'

type Provider = 'steam' | 'playstation'
const NAME: Record<Provider, string> = { steam: 'Steam', playstation: 'PlayStation' }

/**
 * "Sync Steam" / "Sync PlayStation" on that shelf: reads the provider's list
 * and imports it (new games added, playtime refreshed, only empty metadata
 * filled). An explicit tap only — never on load (the lazy-loading rule).
 */
export function TgProviderSync({ library, games, compact = false }: { library: Provider; games: readonly TgGame[]; compact?: boolean }) {
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const last = lastSynced(games, library)

  async function run() {
    if (busy) return
    setBusy(true)
    const tid = toast.loading(`Reading your ${NAME[library]} library…`)
    try {
      const rows = library === 'steam'
        ? steamImportRows((await qc.fetchQuery({ queryKey: ['steam', 'owned-games'], queryFn: fetchSteamOwnedGames, staleTime: 0 })).games)
        : psnImportRows(await qc.fetchQuery({ queryKey: ['psn', 'played-games'], queryFn: fetchPsnPlayedGames, staleTime: 0 }))
      if (!rows.length) throw new Error(`${NAME[library]} returned no games — check Developer → Connections.`)
      const { imported, updated, promoted } = await importProviderGames(library, library === 'steam' ? 'steam' : 'psn', rows)
      toast.dismiss(tid)
      const bits = [imported ? `${imported} added` : null, updated ? `${updated} refreshed` : null, promoted ? `${promoted} now playing` : null].filter(Boolean)
      toast.success(bits.length ? `${NAME[library]}: ${bits.join(' · ')} ✓` : `${NAME[library]} is up to date ✓`)
      qc.invalidateQueries({ queryKey: ['games'] })
    } catch (e) {
      toast.dismiss(tid)
      const msg = (e as Error).message
      logError(`games_provider_sync_${library}: ${msg}`)
      toast.error(msg)
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button" onClick={run} disabled={busy}
      title={`Adds new ${NAME[library]} games and refreshes playtime; your status, rating and notes are never touched.${last ? ` Last synced ${formatDay(last)}.` : ''}`}
      className={`tg-btn tg-btn-secondary shrink-0 ${compact ? '!px-3 !text-[12.5px]' : '!px-3.5 !text-[13px]'}`}
    >
      <RefreshCw aria-hidden className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} strokeWidth={2} />
      <span className="flex flex-col items-start leading-tight">
        <span>{busy ? 'Syncing…' : `Sync ${NAME[library]}`}</span>
        {!compact && last && <span className="text-[10.5px] font-normal tg-muted">last {formatDay(last)}</span>}
      </span>
    </button>
  )
}
