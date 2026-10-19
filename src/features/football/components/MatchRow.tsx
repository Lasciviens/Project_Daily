import { CalendarCheck } from 'lucide-react'
import { Truncate, cx } from '../../../shared/ui'
import { useEntityModal } from '../../../shared/modals'
import { osloParts, type FbMatch, type FbSide } from '../footballModel'
import { scoreText } from '../footballView'
import { TeamLogo } from './TeamLogo'

/**
 * One match on one line, home | time or score | away, as football writes it.
 * The details (venue, goals, line-ups, Plan it) wait behind a tap: the match popup.
 */
export function MatchRow({ match, planned }: { match: FbMatch; planned: boolean }) {
  const modal = useEntityModal()
  const score = scoreText(match)
  const live = match.state === 'in'
  const { time } = osloParts(match.kickoff)
  const side = (s: FbSide, align: 'home' | 'away') => (
    <span className={cx('flex min-w-0 items-center gap-2', align === 'home' && 'flex-row-reverse text-right')}>
      <TeamLogo src={s.team.logo} size={20} />
      <Truncate className={cx('text-body text-fg', s.winner === true ? 'font-semibold' : 'font-medium')}>{s.team.short}</Truncate>
    </span>
  )
  const centre = match.state === 'postponed' ? <span className="text-meta font-medium text-warn">Postponed</span>
    : match.state === 'canceled' ? <span className="text-meta font-medium text-fg-muted">Cancelled</span>
    : score ? <span className={cx('text-ui tabular-nums', live ? 'text-success' : 'text-fg')}>{score}</span>
    : match.timeValid ? <span className="text-body font-semibold tabular-nums text-fg">{time}</span>
    : <span className="text-meta text-fg-muted">Not set</span>
  const under = live ? <span className="text-micro tabular-nums text-success">{match.clock || 'Live'}</span>
    : planned && match.state === 'pre' ? <CalendarCheck aria-label="In your day" className="h-3 w-3 text-info" />
    : null
  return (
    <button
      type="button"
      onClick={() => match.league && modal.open({ kind: 'football-match', eventId: match.id, league: match.league.slug })}
      className="row row-interactive grid w-full grid-cols-[minmax(0,1fr)_4rem_minmax(0,1fr)] items-center gap-2 text-left"
    >
      {side(match.home, 'home')}
      <span className="flex flex-col items-center leading-tight">{centre}{under}</span>
      {side(match.away, 'away')}
    </button>
  )
}
