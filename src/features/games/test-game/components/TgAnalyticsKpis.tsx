import type { ReactNode } from 'react'
import { ChevronRight, Hourglass, LibraryBig, Star } from 'lucide-react'
import { formatPlaytime } from '../../api/playtimeFormat'
import type { TgaKpis, TgaTile } from './tgAnalyticsModel'
import { TGA_CARD, fmtInt, fmtPct, plural } from './tgAnalyticsFormat'
import { TgStatusIcon } from './TgStatusIcon'
import { TgStars } from './TgStars'

const CHIP = 'grid h-8 w-8 shrink-0 place-items-center rounded-[10px]'

function Tile({ icon, label, value, adornment, sub, onOpen }: {
  icon: ReactNode; label: string; value: string; adornment?: ReactNode; sub: string; onOpen: () => void
}) {
  return (
    <li className="min-w-0">
      <button
        type="button"
        onClick={onOpen}
        aria-haspopup="dialog"
        aria-label={`${label}: ${value}, ${sub}. Show the games`}
        className={`${TGA_CARD} group flex h-full w-full flex-col p-4 text-left transition-shadow ring-[color-mix(in_srgb,var(--tg-accent)_50%,transparent)] [@media(hover:hover)]:hover:ring-1 [@media(hover:none)]:active:ring-1 [@media(hover:none)]:active:scale-[0.99]`}
      >
        <span className="flex w-full min-w-0 items-center gap-2.5">
          {icon}
          <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-[var(--tg-text-2)]">{label}</span>
          <ChevronRight size={14} strokeWidth={2.2} aria-hidden className="shrink-0 text-[var(--tg-faint)] transition-transform [@media(hover:hover)]:group-hover:translate-x-0.5" />
        </span>
        <span className="mt-3.5 flex min-h-[30px] w-full items-center justify-between gap-2">
          <span className="truncate text-[26px] font-semibold leading-none tracking-[-0.02em] text-[var(--tg-text)]">{value}</span>
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

/** A small completion ring in the Completed status colour; the percentage itself is in the text. */
function Ring({ share }: { share: number }) {
  const r = 12
  const c = 2 * Math.PI * r
  return (
    <svg viewBox="0 0 30 30" width={30} height={30} aria-hidden data-status="completed" className="shrink-0 -rotate-90">
      <circle cx={15} cy={15} r={r} fill="none" strokeWidth={4} style={{ stroke: 'var(--st-soft)' }} />
      {share > 0 && (
        <circle
          cx={15} cy={15} r={r} fill="none" strokeWidth={4} strokeLinecap="round"
          strokeDasharray={`${Math.max(0.04, share) * c} ${c}`} style={{ stroke: 'var(--st)' }}
        />
      )}
    </svg>
  )
}

/** The headline row: six figures, each opening the list of games behind it. */
export function TgAnalyticsKpis({ k, windowed, onOpen }: { k: TgaKpis; windowed: boolean; onOpen: (t: TgaTile) => void }) {
  const rate = k.completionBase ? k.completed / k.completionBase : 0
  return (
    <ul className="grid grid-cols-2 gap-3 @xl:grid-cols-3 @[62rem]:grid-cols-6 @[62rem]:gap-4">
      <Tile
        icon={<span className={`${CHIP} bg-[var(--tg-accent-soft)] text-[var(--tg-accent)]`}><LibraryBig size={16} strokeWidth={2} /></span>}
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
        sub={k.queued ? `${fmtInt(k.queued)} in your play queue` : 'Nothing queued next'}
      />
      <Tile
        icon={<StatusChip status="completed" />}
        label={windowed ? 'Finished' : 'Completed'}
        onOpen={() => onOpen('completed')}
        value={fmtInt(k.completed)}
        adornment={k.completionBase > 0 ? <Ring share={rate} /> : undefined}
        sub={k.completionBase ? `${fmtPct(k.completed, k.completionBase)} of ${windowed ? 'games played' : 'owned games'}` : 'Nothing to complete yet'}
      />
      <Tile
        icon={<span className={`${CHIP} bg-[var(--tg-accent-soft)] text-[var(--tg-accent)]`}><Hourglass size={16} strokeWidth={2} /></span>}
        label="Playtime"
        onOpen={() => onOpen('playtime')}
        value={k.playtimeSeconds > 0 ? formatPlaytime(k.playtimeSeconds / 60) : '—'}
        sub={k.playedGames ? `lifetime total of ${plural(k.playedGames, 'game')}${windowed ? ' played' : ''}` : 'No play time recorded'}
      />
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
        sub={k.rated ? `from ${plural(k.rated, 'rated game')}` : 'No ratings yet'}
      />
      <Tile
        icon={<StatusChip status="backlog" />}
        label="Backlog"
        onOpen={() => onOpen('backlog')}
        value={fmtInt(k.backlog)}
        sub={k.backlog ? `${fmtInt(k.backlogUnplayed)} with no play time` : 'Backlog is clear'}
      />
    </ul>
  )
}
