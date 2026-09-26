import type { ReactNode } from 'react'
import { ChevronRight, Gamepad2, Hourglass, LibraryBig, Star } from 'lucide-react'
import { formatPlaytime } from '../../api/playtimeFormat'
import type { TgaKpis, TgaTile } from './tgAnalyticsModel'
import { TGA_CARD, fmtInt, kpiPlaytime, plural } from './tgAnalyticsFormat'
import { backlogSub, completedShare, completedSub, playedSub, playingSub } from './tgAnalyticsDrillCopy'
import { TgStatusIcon } from './TgStatusIcon'
import { TgStars } from './TgStars'

const CHIP = 'grid h-8 w-8 shrink-0 place-items-center rounded-[10px]'

function Tile({ icon, label, value, exact, adornment, sub, onOpen }: {
  icon: ReactNode; label: string; value: string
  /** The unrounded figure, for the accessible name and a tooltip, when `value` is shortened. */
  exact?: string
  adornment?: ReactNode; sub: string; onOpen: () => void
}) {
  return (
    <li className="min-w-0">
      <button
        type="button"
        onClick={onOpen}
        aria-haspopup="dialog"
        aria-label={`${label}: ${exact ?? value}, ${sub}. Show the games`}
        className={`${TGA_CARD} group flex h-full w-full flex-col p-4 text-left transition-shadow ring-[color-mix(in_srgb,var(--tg-accent)_50%,transparent)] [@media(hover:hover)]:hover:ring-1 [@media(hover:none)]:active:ring-1 [@media(hover:none)]:active:scale-[0.99]`}
      >
        <span className="flex w-full min-w-0 items-center gap-2.5">
          {icon}
          <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-[var(--tg-text-2)]">{label}</span>
          <ChevronRight size={14} strokeWidth={2.2} aria-hidden className="hidden shrink-0 text-[var(--tg-faint)] transition-transform @md:block [@media(hover:hover)]:group-hover:translate-x-0.5" />
        </span>
        <span className="mt-3.5 flex min-h-[30px] w-full items-center justify-between gap-2">
          <span title={exact} className="truncate text-[22px] font-semibold leading-none tracking-[-0.02em] text-[var(--tg-text)] @md:text-[26px]">{value}</span>
          {adornment}
        </span>
        <span className="mt-2 text-[12px] leading-snug text-[var(--tg-muted)]">{sub}</span>
      </button>
    </li>
  )
}

function StatusChip({ status }: { status: string }) {
  return (
    <span data-status={status} className={`${CHIP} bg-[var(--st-soft)]`}>
      <TgStatusIcon status={status} size={16} />
    </span>
  )
}

/**
 * A small share ring: the Completed status colour, or the accent for Played.
 * The percentage itself is always in the tile's text.
 */
function Ring({ share, status }: { share: number; status?: 'completed' }) {
  const r = 12
  const c = 2 * Math.PI * r
  const [track, fill] = status ? ['var(--st-soft)', 'var(--st)'] : ['var(--tg-accent-soft)', 'var(--tg-accent)']
  return (
    <svg viewBox="0 0 30 30" width={30} height={30} aria-hidden data-status={status} className="shrink-0 -rotate-90">
      <circle cx={15} cy={15} r={r} fill="none" strokeWidth={4} style={{ stroke: track }} />
      {share > 0 && (
        <circle
          cx={15} cy={15} r={r} fill="none" strokeWidth={4} strokeLinecap="round"
          strokeDasharray={`${Math.max(0.04, share) * c} ${c}`} style={{ stroke: fill }}
        />
      )}
    </svg>
  )
}

const accentChip = (icon: ReactNode) => <span className={`${CHIP} bg-[var(--tg-accent-soft)] text-[var(--tg-accent)]`}>{icon}</span>

/**
 * The headline row: six figures, each opening the list of games behind it.
 * With fewer than three ratings an average says nothing, so that slot shows
 * how much of the view has recorded play instead.
 */
export function TgAnalyticsKpis({ k, windowed, onOpen }: { k: TgaKpis; windowed: boolean; onOpen: (t: TgaTile) => void }) {
  const share = completedShare(k, windowed)
  return (
    <ul className="grid grid-cols-2 gap-3 @xl:grid-cols-3 @[62rem]:grid-cols-6 @[62rem]:gap-4">
      <Tile
        icon={accentChip(<LibraryBig size={16} strokeWidth={2} />)}
        label={windowed ? 'Games played' : 'Games'}
        onOpen={() => onOpen('games')}
        value={fmtInt(k.games)}
        sub={`across ${plural(k.platforms, 'platform')}`}
      />
      <Tile
        icon={<StatusChip status="playing" />}
        label="Playing now"
        onOpen={() => onOpen('playing')}
        value={fmtInt(k.playing)}
        sub={playingSub(k, windowed)}
      />
      <Tile
        icon={<StatusChip status="completed" />}
        label={windowed ? 'Finished' : 'Completed'}
        onOpen={() => onOpen('completed')}
        value={fmtInt(k.completed)}
        adornment={share != null ? <Ring share={share} status="completed" /> : undefined}
        sub={completedSub(k, windowed)}
      />
      <Tile
        icon={accentChip(<Hourglass size={16} strokeWidth={2} />)}
        label="Playtime"
        onOpen={() => onOpen('playtime')}
        value={k.playtimeSeconds > 0 ? kpiPlaytime(k.playtimeSeconds) : '—'}
        exact={k.playtimeSeconds > 0 ? formatPlaytime(k.playtimeSeconds / 60) : undefined}
        sub={k.playedGames ? `lifetime total of ${plural(k.playedGames, 'game')}${windowed ? ' played' : ''}` : 'No play time recorded'}
      />
      {k.rated < 3 ? (
        <Tile
          icon={accentChip(<Gamepad2 size={16} strokeWidth={2} />)}
          label="Played"
          onOpen={() => onOpen('played')}
          value={fmtInt(k.played)}
          adornment={k.games > 0 ? <Ring share={k.played / k.games} /> : undefined}
          sub={playedSub(k)}
        />
      ) : (
        <Tile
          icon={(
            <span className={`${CHIP} bg-[color-mix(in_srgb,var(--tg-star)_16%,transparent)] text-[var(--tg-star)]`}>
              <Star size={16} strokeWidth={0} fill="currentColor" />
            </span>
          )}
          label="Average rating"
          onOpen={() => onOpen('rating')}
          value={k.avgStars != null ? k.avgStars.toFixed(1) : '—'}
          adornment={k.avgStars != null ? <TgStars stars={k.avgStars} size={13} className="shrink-0" /> : undefined}
          sub={`from ${plural(k.rated, 'rated game')}`}
        />
      )}
      <Tile
        icon={<StatusChip status="backlog" />}
        label="Backlog"
        onOpen={() => onOpen('backlog')}
        value={fmtInt(k.backlog)}
        sub={backlogSub(k, windowed)}
      />
    </ul>
  )
}
