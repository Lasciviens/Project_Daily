import { Users } from 'lucide-react'
import type { playerRows } from './tgAnalyticsMore'
import { plural } from './tgAnalyticsFormat'
import { unknownPlayersNote } from './tgAnalyticsCollection'
import { TgAnalyticsBarList } from './TgAnalyticsBarList'
import { TgAnalyticsCard, TgAnalyticsEmpty } from './TgAnalyticsCard'

const noop = () => {}

/** Games by the most players they allow ("1–4" counts as up to four). */
export function TgAnalyticsPlayers({ players, className = '' }: { players: ReturnType<typeof playerRows>; className?: string }) {
  const known = players.rows.reduce((n, r) => n + r.count, 0)
  return (
    <TgAnalyticsCard label="Players" meta={known ? plural(known, 'game') : undefined} className={className}>
      {known ? (
        <>
          <TgAnalyticsBarList rows={players.rows} onOpen={noop} openLabel={row => row.label} />
          {players.unknown > 0 && <p className="mt-3 text-[11.5px] text-[var(--tg-muted)]">{unknownPlayersNote(players.unknown)}.</p>}
        </>
      ) : (
        <TgAnalyticsEmpty
          icon={Users} title="No player counts recorded"
          hint="How many can play arrives with ES-DE and ScreenScraper metadata, or from a game's Edit form."
        />
      )}
    </TgAnalyticsCard>
  )
}
