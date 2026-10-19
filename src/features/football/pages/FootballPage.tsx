import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Plus, Search, Trophy } from 'lucide-react'
import { Button, Card, CardHeader, EmptyState, PageBoard, PageContainer, PageHeader, Skeleton, ToneDot, cx } from '../../../shared/ui'
import { ErrorBoundary } from '../../../shared/components/ErrorBoundary'
import { useEntityModal } from '../../../shared/modals'
import { FootballHeroArt } from '../components/FootballHeroArt'
import { FollowingCard } from '../components/FollowingCard'
import { MatchList } from '../components/MatchList'
import { StandingsCard } from '../components/StandingsCard'
import { TeamLogo } from '../components/TeamLogo'
import { FOOTBALL_BOARD } from '../footballBoard'
import { filterMatches, SUGGESTIONS, tableLeagues, type FollowFilter } from '../footballView'
import { runFootballSync } from '../hooks/footballSync'
import { useFollow, useFollows, useFootballAgenda, usePlannedTasks } from '../hooks/useFootball'
import type { FootballFollow } from '../types'

/** Now, to the minute: the agenda moves a match from "coming up" to live to a result as time passes. */
function useMinute(): string {
  const stamp = () => new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString()
  const [now, setNow] = useState(stamp)
  useEffect(() => {
    const id = window.setInterval(() => setNow(stamp()), 60_000)
    return () => window.clearInterval(id)
  }, [])
  return now
}

const filterKey = (f: { kind: string; ref: string }) => `${f.kind}:${f.ref}`

export function FootballPage() {
  const qc = useQueryClient()
  const modal = useEntityModal()
  const followsQ = useFollows()
  const follows = useMemo(() => followsQ.data ?? [], [followsQ.data])
  const planned = usePlannedTasks()
  const now = useMinute()
  const { agenda, loading, failed, retry } = useFootballAgenda(follows, now)
  const [params, setParams] = useSearchParams()
  const picked = params.get('f')
  const current = follows.find(f => filterKey(f) === picked)
  const filter: FollowFilter = current ? { kind: current.kind, ref: current.ref } : null
  const pick = (f: FootballFollow | null) => setParams(p => {
    const n = new URLSearchParams(p)
    if (f) n.set('f', filterKey(f)); else n.delete('f')
    return n
  }, { replace: true })

  // A visit runs the subscription too, unless it ran in the last 5 minutes (the app's own run waits 30).
  useEffect(() => { void runFootballSync(qc, { within: 5 * 60_000 }) }, [qc])

  const followed = useMemo(() => new Set(follows.filter(f => f.kind === 'team').map(f => f.ref)), [follows])
  const live = filterMatches(agenda.live, filter)
  const coming = filterMatches(agenda.upcoming.flatMap(d => d.matches), filter)
  const results = filterMatches(agenda.results, filter)
  // A tournament's table only while it has matches on the page (a finished World Cup shows its old groups otherwise).
  const active = useMemo(() => new Set([...agenda.live, ...agenda.upcoming.flatMap(d => d.matches), ...agenda.results].map(m => m.league?.slug ?? '')), [agenda])
  const leagues = tableLeagues(follows, filter, active)
  // A tournament picked in the filter shows all its matches; otherwise a busy night folds.
  const keep = filter?.kind === 'league' ? Infinity : 3
  const openFollow = () => modal.open({ kind: 'football-follow' })

  const problem = failed.length > 0 && (
    <p className="text-meta text-fg-muted">
      Couldn't read {failed.join(', ')} from ESPN.{' '}
      <button type="button" className="font-semibold text-accent-600" onClick={retry}>Try again</button>
    </p>
  )
  const rows = (n: number) => <div className="flex flex-col gap-2">{Array.from({ length: n }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>

  return (
    <PageContainer>
      <PageHeader
        title="Football"
        art={<FootballHeroArt />}
        actions={<Button variant="primary" icon={<Plus />} onClick={openFollow}>Follow</Button>}
      >
        {follows.length > 1 && (
          <div className="scroll-x -mx-1 flex gap-1 px-1" role="group" aria-label="Show">
            <button type="button" aria-pressed={!filter} onClick={() => pick(null)} className="pill-tab shrink-0">All</button>
            {follows.map(f => (
              <button key={f.id} type="button" aria-pressed={current?.id === f.id} onClick={() => pick(f)} className="pill-tab shrink-0 gap-2">
                <TeamLogo src={f.logo} kind={f.kind} size={16} />{f.name}
              </button>
            ))}
          </div>
        )}
      </PageHeader>

      {followsQ.isLoading ? (
        <div className="flex max-w-[56rem] flex-col gap-3">
          <Skeleton rounded="rounded-card" className="h-56" />
          <Skeleton rounded="rounded-card" className="h-40" />
        </div>
      ) : followsQ.isError ? (
        <EmptyState
          className="max-w-md" bordered title="Couldn't load what you follow"
          action={<Button size="sm" onClick={() => { void followsQ.refetch() }}>Try again</Button>}
        />
      ) : follows.length === 0 ? (
        <FirstFollow onSearch={openFollow} />
      ) : (
        <ErrorBoundary label="Football" action="football_page">
          <PageBoard
            layout={FOOTBALL_BOARD}
            sections={{
              live: live.length > 0 && (
                <Card>
                  <CardHeader title={<span className="flex items-center gap-2"><ToneDot tone="success" className="motion-safe:animate-pulse" />Live</span>} variant="label" />
                  <MatchList matches={live} planned={planned} featured={followed} keep={keep} />
                </Card>
              ),
              next: (
                <Card>
                  <CardHeader title="Coming up" variant="label" />
                  <div className="flex flex-col gap-2">
                    {loading && !coming.length ? rows(4)
                      : coming.length ? <MatchList matches={coming} planned={planned} featured={followed} keep={keep} />
                      : <p className="text-body text-fg-muted">No matches in the next 30 days.</p>}
                    {problem}
                  </div>
                </Card>
              ),
              results: (
                <Card>
                  <CardHeader title="Results" subtitle="Last 10 days" variant="label" />
                  {loading && !results.length ? rows(3)
                    : results.length ? <MatchList matches={results} planned={planned} featured={followed} keep={keep} days={4} />
                    : <p className="text-body text-fg-muted">No results in the last 10 days.</p>}
                </Card>
              ),
              tables: leagues.length > 0 && (
                <div className="flex flex-col gap-3 sm:gap-4">
                  {leagues.map(l => (
                    <ErrorBoundary key={l} label="Table" action="football_table">
                      <StandingsCard league={l} followed={followed} />
                    </ErrorBoundary>
                  ))}
                </div>
              ),
              following: <FollowingCard follows={follows} onPick={pick} />,
            }}
          />
        </ErrorBoundary>
      )}
    </PageContainer>
  )
}

/** No follows yet: the four the owner named, one tap each, or a search. */
function FirstFollow({ onSearch }: { onSearch: () => void }) {
  const follow = useFollow()
  return (
    <EmptyState
      className="max-w-lg" bordered icon={<Trophy />}
      title="Follow a team or a tournament"
      description="Their fixtures, results and tables show here. Subscribe to a team and its matches go into your day."
      action={(
        <div className="flex flex-wrap justify-center gap-2">
          {SUGGESTIONS.map((s, i) => (
            <Button
              key={s.ref} size="sm" loading={follow.isPending && follow.variables?.input.ref === s.ref}
              icon={<TeamLogo src={s.logo} kind={s.kind} size={16} />}
              onClick={() => follow.mutate({ input: s, sortOrder: i })}
              className={cx(follow.isPending && 'pointer-events-none')}
            >
              {s.name}
            </Button>
          ))}
          <Button size="sm" variant="ghost" icon={<Search />} onClick={onSearch}>Search others</Button>
        </div>
      )}
    />
  )
}
