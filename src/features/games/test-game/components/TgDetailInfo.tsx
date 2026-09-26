import { Building2, CalendarCheck, CalendarDays, Clock3, UserRound, type LucideIcon } from 'lucide-react'
import { formatPlaytime } from '../../api/playtimeFormat'
import { formatDay, lastPlayedIso, playSeconds, type TgGame } from '../testGameModel'
import type { SteamExtras } from './useSteamExtras'

interface Row { icon: LucideIcon; label: string; value: string }

const DASH = '—'
const text = (...xs: (string | null | undefined)[]) => xs.map(x => x?.trim()).find(Boolean) ?? DASH

function rowsFor(game: TgGame, extras: SteamExtras): Row[] {
  const seconds = playSeconds(game)
  const last = lastPlayedIso(game)
  const rows: Row[] = [
    { icon: Clock3, label: 'Playtime', value: seconds == null ? DASH : formatPlaytime(seconds / 60) },
    // No date is "nothing recorded", not "never": ES-DE only counts what it
    // launched, and old Steam games report hours with no last-played date.
    { icon: CalendarDays, label: 'Last Played', value: last ? formatDay(last) : (seconds ?? 0) > 0 ? DASH : 'No recorded play' },
    { icon: UserRound, label: 'Developer', value: text(game.developer, extras.developer) },
    { icon: Building2, label: 'Publisher', value: text(game.publisher, extras.publisher) },
  ]
  if (game.play_status === 'completed' && game.finished_at) {
    rows.push({ icon: CalendarCheck, label: 'Finished', value: formatDay(game.finished_at) })
  }
  return rows
}

/** Icon · label · value rows, the two text columns aligned down the panel. */
export function TgDetailInfo({ game, extras }: { game: TgGame; extras: SteamExtras }) {
  return (
    <dl className="flex flex-col gap-[3px] [@media(min-height:1000px)]:gap-2">
      {rowsFor(game, extras).map(({ icon: Icon, label, value }) => (
        // `!` overrides .tg-info-row's column split, which loads after
        // Tailwind: the design lines the values up at the panel's midpoint.
        <div key={label} className="tg-info-row !grid-cols-[20px_minmax(0,1fr)_minmax(0,1fr)] leading-[1.5] 2xl:!text-[14px]">
          <Icon aria-hidden className="mt-[2px] h-4 w-4 text-[var(--tg-text-2)]" strokeWidth={1.75} />
          <dt className="tg-info-label truncate">{label}</dt>
          <dd className="tg-info-value break-words">{value}</dd>
        </div>
      ))}
    </dl>
  )
}
