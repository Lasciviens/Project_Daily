import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarClock, History, ListOrdered, Radio, TrendingUp, Trophy } from 'lucide-react'
import { Cell, CellHeader, CellLink, StatBox, StatEmpty, StatNote, StatValue } from './cellKit'
import { TonePill, Truncate, cx, type Tone } from '../../../../shared/ui'
import { useEntityModal } from '../../../../shared/modals'
import { ErrorBoundary } from '../../../../shared/components/ErrorBoundary'
import { formatDate, formatWeekdayDate } from '../../../../shared/utils/dateFormat'
import { todayStr } from '../../../../shared/utils/dateUtils'
import { useFavouriteTeamsGlance } from '../../../football/hooks/useFavouriteTeamsGlance'
import { RESULTS_SHOWN, type FavouriteTeamGlance, type GlanceResult } from '../../../football/footballGlance'

// Personal's Football card (owner, 26.10.2026: "favourite team(s), with the
// favourite selected on the Football page: how they're doing and the next
// match"): the starred team's table place, its form, its last results with
// their scores (owner, 31.10.2026: "add last results as well") and its next
// match — or the score while it plays. Only useFavouriteTeamsGlance (the
// Football page's own reads); a tap opens the club or the match, where Plan it is.

const OUTCOME_TONE: Record<'W' | 'D' | 'L', Tone> = { W: 'success', D: 'neutral', L: 'danger' }
const ordinal = (n: number) => {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'
  return `${n}${s}`
}

function TeamGlance({ team, date, today }: { team: FavouriteTeamGlance; date: string; today: string }) {
  const modal = useEntityModal()
  // The shown day's own match (its result once played), else what is live, else the next one.
  const day = team.onDay && (date !== today || team.onDay.state === 'post' || !team.next) ? team.onDay : null
  const match = team.live ?? day ?? team.next
  const vs = match ? `${match.home ? 'v' : 'at'} ${match.opponent}` : ''
  const label = team.live ? 'Live' : day ? (date === today ? 'Today' : formatWeekdayDate(date)) : 'Next match'
  const value = team.live ? `${team.live.score}${team.live.minute ? ` · ${team.live.minute}` : ''}`
    : day?.state === 'post' && day.score ? `${day.outcome ? `${day.outcome} ` : ''}${day.score}` : vs
  const note = team.live ? vs
    : day?.state === 'post' ? [vs, day.competition].filter(Boolean).join(' · ')
    : match ? [day ? null : formatWeekdayDate(match.day), match.time, match.competition].filter(Boolean).join(' · ') : ''
  const tone = team.live ? 'danger' as const : day?.state === 'post' && day.outcome ? OUTCOME_TONE[day.outcome] : undefined
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
      <LastResults results={team.results.filter(r => r.eventId !== match?.eventId).slice(0, RESULTS_SHOWN)} />
      {match ? (
        <StatBox icon={team.live ? <Radio aria-hidden /> : <CalendarClock aria-hidden />} label={label}
          ariaLabel={`${label}: ${team.name} ${vs} — open the match`}
          onClick={() => match.league && modal.open({ kind: 'football-match', eventId: match.eventId, league: match.league })}>
          <StatValue text tone={tone}>{value}</StatValue>
          {note && <StatNote>{note}</StatNote>}
        </StatBox>
      ) : (
        <p className="text-meta text-fg-muted">No match coming up.</p>
      )}
    </div>
  )
}

/** The last results, newest first: each line its result, the score (home first) and the other side; a tap opens the match. */
function LastResults({ results }: { results: readonly GlanceResult[] }) {
  const modal = useEntityModal()
  if (results.length === 0) return null
  return (
    <StatBox icon={<History aria-hidden />} label="Last results">
      <ul className="-mx-1 flex flex-col">
        {results.map(r => (
          <li key={r.eventId}>
            <button type="button" disabled={!r.league}
              onClick={() => r.league && modal.open({ kind: 'football-match', eventId: r.eventId, league: r.league })}
              aria-label={`${r.outcome === 'W' ? 'Won' : r.outcome === 'L' ? 'Lost' : 'Drew'} ${r.score} ${r.home ? 'v' : 'at'} ${r.opponent}, ${formatDate(r.day)} — open the match`}
              className="flex min-h-[32px] w-full min-w-0 items-center gap-2 rounded-control px-1 text-left hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/40">
              <TonePill tone={OUTCOME_TONE[r.outcome]} className="w-6 shrink-0 justify-center">{r.outcome}</TonePill>
              <span className="shrink-0 text-body font-semibold tabular-nums text-fg">{r.score}</span>
              <Truncate className="min-w-0 flex-1 text-body text-fg-2">{`${r.home ? 'v' : 'at'} ${r.opponent}`}</Truncate>
              <span className="shrink-0 text-meta tabular-nums text-fg-muted">{formatDate(r.day)}</span>
            </button>
          </li>
        ))}
      </ul>
    </StatBox>
  )
}

export function FootballCard({ date }: { date: string }) {
  const g = useFavouriteTeamsGlance({ day: date })
  const today = todayStr()
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
          <TeamGlance team={team} date={date} today={today} />
          {g.failed.includes(team.name) && <p className="text-meta text-fg-muted">ESPN didn't answer for {team.name} just now.</p>}
        </ErrorBoundary>
      )}
    </Cell>
  )
}
