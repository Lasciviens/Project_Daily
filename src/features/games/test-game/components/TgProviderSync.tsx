import { RefreshCw } from 'lucide-react'
import { formatDay, type TgGame } from '../testGameModel'
import { lastSynced } from './tgProviderSync'
import { PROVIDER_NAME as NAME, useProviderSync, type SyncProvider as Provider } from '../useProviderSync'

/**
 * "Sync Steam" / "Sync PlayStation" on that shelf: reads the provider's list
 * and imports it (new games added, playtime refreshed, only empty metadata
 * filled). Opening Games also syncs by itself once a day (useProviderAutoSync);
 * this is the on-demand one. `iconOnly` (the phone's crowded scope row): a
 * 44px icon button, the words in its label and tooltip.
 */
export function TgProviderSync({ library, games, compact = false, iconOnly = false }: { library: Provider; games: readonly TgGame[]; compact?: boolean; iconOnly?: boolean }) {
  const { run, busy } = useProviderSync(library)
  const last = lastSynced(games, library)

  const title = `Adds new ${NAME[library]} games and refreshes playtime (also once a day by itself when you open Games); your status, rating and notes are never touched.${last ? ` Last synced ${formatDay(last)}.` : ''}`
  if (iconOnly) {
    return (
      <button
        type="button" onClick={run} disabled={busy} title={title}
        aria-label={busy ? `Syncing ${NAME[library]}…` : `Sync ${NAME[library]}${last ? ` (last ${formatDay(last)})` : ''}`}
        className="tg-icon-btn is-bordered shrink-0"
      >
        <RefreshCw aria-hidden className={`h-[18px] w-[18px] ${busy ? 'animate-spin' : ''}`} strokeWidth={1.9} />
      </button>
    )
  }
  return (
    <button
      type="button" onClick={run} disabled={busy}
      title={title}
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
