import { useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Plus, Search, Trophy } from 'lucide-react'
import { Button, Card, CardHeader, EmptyState, KeepRoom, PageBoard, PageContainer, PageHeader, Skeleton, ToneDot, cx } from '../../../shared/ui'
import { rememberedLayout, useRememberedFlag } from '../../../shared/hooks/useLayoutMemory'
import { ErrorBoundary } from '../../../shared/components/ErrorBoundary'
import { useEntityModal } from '../../../shared/modals'
import { FootballHeroArt } from '../components/FootballHeroArt'
import { FollowingCard } from '../components/FollowingCard'
import { MatchList, MatchListSkeleton } from '../components/MatchList'
import { StandingsCard } from '../components/StandingsCard'
import { TeamLogo } from '../components/TeamLogo'
import { FOOTBALL_BOARD } from '../footballBoard'
import { filterMatches, SUGGESTIONS, tableLeagues, type FollowFilter } from '../footballView'
import { runFootballSync } from '../hooks/footballSync'
import { useFollow, useFollows, useFootballAgenda, usePlannedTasks } from '../hooks/useFootball'
import { useMinute } from '../hooks/useMinute'
import type { FootballFollow } from '../types'

const filterKey = (f: { kind: string; ref: string }) => `${f.kind}:${f.ref}`

/**
 * The room (rem) each match list keeps while ESPN answers, before this device has seen it loaded — the
 * height the lists' loading copies always had. After that, the height of its last full answer (KeepRoom). A
 * failed read never keeps it: the card shrinks to its one error line, with the room back for Try again.
 */
const FIRST_ROOM = { coming: 11.5, results: 8.5 }
const listRoom = (key: string, first: number) => {
  const last = rememberedLayout(key)
  return typeof last === 'number' && last > 0 ? last : first
}

export function FootballPage() {
  const qc = useQueryClient()
  const modal = useEntityModal()
  const followsQ = useFollows()
  const follows = useMemo(() => followsQ.data ?? [], [followsQ.data])
  const planned = usePlannedTasks()
  const now = useMinute()
  const { agenda, loading, failed, retrying, retry } = useFootballAgenda(follows, now)
  // The lists keep their room while ESPN answers, and again while a failed read is tried again.
  const listsLoading = loading || retrying
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
  // The filter row comes with what you follow (two or more): its room is kept while they load only when it
  // showed last time — kept for one follow, it dropped the page when the follows landed.
  const filterRoom = useRememberedFlag('football:filter', follows.length > 1, !followsQ.isLoading && !followsQ.isError)
  // Keyed by a follow the owner has, never by the raw `?f=` of a link (any text, any length).
  const listKey = current ? filterKey(current) : 'all'
  const comingKey = `football:coming:${listKey}`
  const resultsKey = `football:results:${listKey}`

  const problem = failed.length > 0 && (
    <p className="text-meta text-fg-muted">
      Couldn't read {failed.join(', ')} from ESPN.{' '}
      <button type="button" className="font-semibold text-accent-600" onClick={retry}>Try again</button>
    </p>
  )

  return (
    <PageContainer>
      <PageHeader
        title="Football"
        art={<FootballHeroArt />}
        actions={<Button variant="primary" icon={<Plus />} onClick={openFollow}>Follow</Button>}
      >
        {followsQ.isLoading && filterRoom && (
          <div aria-hidden className="flex gap-1">
            {[0, 1, 2].map(i => <Skeleton key={i} rounded="rounded-full" className="h-[34px] w-24 [@media(pointer:coarse)]:h-[44px]" />)}
          </div>
        )}
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
                  <KeepRoom
                    ids={comingKey} loading={listsLoading} first={FIRST_ROOM.coming} remember={failed.length === 0}
                    className="flex flex-col gap-2"
                    skeleton={coming.length ? undefined : <MatchListSkeleton rem={listRoom(comingKey, FIRST_ROOM.coming)} />}
                  >
                    {coming.length ? <MatchList matches={coming} planned={planned} featured={followed} keep={keep} />
                      : failed.length === 0 && <p className="text-body text-fg-muted">No matches in the next 30 days.</p>}
                    {/* Once every read answered: shown under the loading copy, it grew the card for a moment. */}
                    {!listsLoading && problem}
                  </KeepRoom>
                </Card>
              ),
              results: (
                <Card>
                  <CardHeader title="Results" subtitle="Last 10 days" variant="label" />
                  <KeepRoom
                    ids={resultsKey} loading={listsLoading} first={FIRST_ROOM.results} remember={failed.length === 0}
                    skeleton={results.length ? undefined : <MatchListSkeleton rem={listRoom(resultsKey, FIRST_ROOM.results)} rows={2} />}
                  >
                    {/* A failed read never says "no results": Coming up's card has the one error line. */}
                    {results.length ? <MatchList matches={results} planned={planned} featured={followed} keep={keep} days={4} />
                      : failed.length === 0 && <p className="text-body text-fg-muted">No results in the last 10 days.</p>}
                  </KeepRoom>
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

/** No follows yet: the suggestions (the four the owner named and the five big leagues), one tap each, or a search. */
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
