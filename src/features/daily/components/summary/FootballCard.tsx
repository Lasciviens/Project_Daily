import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarClock, ListOrdered, Radio, TrendingUp, Trophy } from 'lucide-react'
import { Cell, CellHeader, CellLink, StatBox, StatEmpty, StatNote, StatValue } from './cellKit'
import { TonePill, Truncate, cx, type Tone } from '../../../../shared/ui'
import { useEntityModal } from '../../../../shared/modals'
import { ErrorBoundary } from '../../../../shared/components/ErrorBoundary'
import { formatWeekdayDate } from '../../../../shared/utils/dateFormat'
import { useFavouriteTeamsGlance } from '../../../football/hooks/useFavouriteTeamsGlance'
import type { FavouriteTeamGlance } from '../../../football/footballGlance'

// Personal's Football card (owner, 26.10.2026: "favourite team(s), with the
// favourite selected on the Football page: how they're doing and the next
// match"): the starred team's table place, its last five results and its
// next match — or the score while it plays. Only useFavouriteTeamsGlance (the
// Football page's own reads); a tap opens the club or the match, where Plan it is.

const OUTCOME_TONE: Record<'W' | 'D' | 'L', Tone> = { W: 'success', D: 'neutral', L: 'danger' }
const ordinal = (n: number) => {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'
  return `${n}${s}`
}

function TeamGlance({ team }: { team: FavouriteTeamGlance }) {
  const modal = useEntityModal()
  const match = team.live ?? team.next
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2">
        <StatBox icon={<ListOrdered aria-hidden />} label={team.leagueName ?? 'Table'} ariaLabel={`${team.name} — open the club`}
          onClick={() => modal.open({ kind: 'football-team', teamId: team.ref, league: team.league ?? undefined })}>
          {team.position == null ? <StatEmpty loading={false} text="No table" /> : (
            <>
              <StatValue>{ordinal(team.position)}</StatValue>
              <StatNote>{[team.points != null ? `${team.points} pts` : null, team.played != null ? `${team.played} played` : null].filter(Boolean).join(' · ')}</StatNote>
            </>
          )}
        </StatBox>
        <StatBox icon={<TrendingUp aria-hidden />} label="Form">
          {team.form.length === 0 ? <StatEmpty loading={false} text="No results yet" /> : (
            <>
              <ol className="mt-0.5 flex gap-1" aria-label={`Last ${team.form.length} results, oldest first: ${team.form.join(', ')}`}>
                {team.form.map((o, i) => <li key={i}><TonePill tone={OUTCOME_TONE[o]} className="w-6 justify-center">{o}</TonePill></li>)}
              </ol>
              <StatNote>last {team.form.length}, newest last</StatNote>
            </>
          )}
        </StatBox>
      </div>
      {match ? (
        <StatBox icon={team.live ? <Radio aria-hidden /> : <CalendarClock aria-hidden />} label={team.live ? 'Live' : 'Next match'}
          ariaLabel={`${team.live ? 'Live' : 'Next'}: ${team.name} ${match.home ? 'v' : 'at'} ${match.opponent} — open the match`}
          onClick={() => match.league && modal.open({ kind: 'football-match', eventId: match.eventId, league: match.league })}>
          <StatValue tone={team.live ? 'danger' : undefined}>
            {team.live ? `${team.live.score}${team.live.minute ? ` · ${team.live.minute}` : ''}` : `${match.home ? 'v' : 'at'} ${match.opponent}`}
          </StatValue>
          <StatNote>
            {team.live ? `${match.home ? 'v' : 'at'} ${match.opponent}` : [formatWeekdayDate(match.day), match.time, match.competition].filter(Boolean).join(' · ')}
          </StatNote>
        </StatBox>
      ) : (
        <p className="text-meta text-fg-muted">No match coming up.</p>
      )}
    </div>
  )
}

export function FootballCard() {
  const g = useFavouriteTeamsGlance()
  const [pick, setPick] = useState<string | null>(null)
  const team = g.teams.find(t => t.id === pick) ?? g.teams[0] ?? null

  return (
    <Cell>
      <CellHeader icon={<Trophy />} title="Football" action={<CellLink to="/football">Football</CellLink>} />
      {g.isLoading && !team ? <StatEmpty loading /> : !team ? (
        <Link to="/football" className="flex min-h-[44px] items-center text-body text-fg-muted hover:text-accent-600">
          Star a team on the Football page to see it here
        </Link>
      ) : (
        <ErrorBoundary>
          {g.teams.length > 1 && (
            <div role="tablist" aria-label="Favourite teams" className="-mt-1 flex gap-1.5 overflow-x-auto scrollbar-none">
              {g.teams.map(t => (
                <button key={t.id} type="button" role="tab" aria-selected={t.id === team.id} onClick={() => setPick(t.id)}
                  className={cx('chip shrink-0', t.id === team.id && 'border-transparent bg-accent-500 text-on-accent')}>
                  <Truncate as="span" className="max-w-[9rem]">{t.name}</Truncate>
                </button>
              ))}
            </div>
          )}
          <div className="flex min-w-0 items-center gap-2">
            {team.logo && <img src={team.logo} alt="" className="h-6 w-6 shrink-0 object-contain" />}
            <Truncate className="text-body font-semibold text-fg">{team.name}</Truncate>
          </div>
          <TeamGlance team={team} />
          {g.failed.includes(team.name) && <p className="text-meta text-fg-muted">ESPN didn't answer for {team.name} just now.</p>}
        </ErrorBoundary>
      )}
    </Cell>
  )
}
