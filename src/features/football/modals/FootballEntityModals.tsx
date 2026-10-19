// Football's popups (useEntityModal kinds, docs/features/football.md): "+ Follow",
// a club, a player, a match. Each loads its own data by id from ESPN (cached) and
// renders inside an ErrorBoundary — ESPN's shapes aren't guaranteed.
import { useState, type ReactNode } from 'react'
import { Disclosure, DisclosureButton, DisclosurePanel } from '@headlessui/react'
import { CalendarCheck, CalendarPlus, ChevronDown, ExternalLink, Search } from 'lucide-react'
import type { EntityModalProps } from '../../../shared/modals/types'
import { EntityModalPending, useEntityModal } from '../../../shared/modals'
import { ModalShell } from '../../../shared/modals/ModalShell'
import { ErrorBoundary } from '../../../shared/components/ErrorBoundary'
import { useDebouncedValue } from '../../../shared/hooks/useDebouncedValue'
import { Button, MetaLine, SectionLabel, SkeletonText, TonePill, Truncate, cx, type Tone } from '../../../shared/ui'
import { formatDate, formatWeekdayDate } from '../../../shared/utils/dateFormat'
import { isLeagueSlug, isTeamId } from '../api/espnApi'
import {
  osloParts, outcomeFor, squadGroups, type FbLineup, type FbMatch, type FbSearchHit, type FbSide,
} from '../footballModel'
import { isFollowed, scoreText, SUGGESTIONS } from '../footballView'
import {
  useFollow, useFollows, useFootballSearch, useMatchDetail, usePlanIt, usePlannedTasks, useRoster, useTeamFixtures,
  useTeamInfo, useTeamResults,
} from '../hooks/useFootball'
import type { NewFollowInput } from '../types'
import { MatchRow } from '../components/MatchRow'
import { SubscribeToggle } from '../components/SubscribeToggle'
import { TeamLogo } from '../components/TeamLogo'

// ─── football-follow ─────────────────────────────────────────────────────────

const followOf = (h: FbSearchHit): NewFollowInput | null => {
  if (h.kind === 'team') return isTeamId(h.ref) ? { kind: 'team', ref: h.ref, name: h.name, logo: h.logo, league: h.league && isLeagueSlug(h.league) ? h.league : null } : null
  return isLeagueSlug(h.ref) ? { kind: 'league', ref: h.ref, name: h.name, logo: h.logo, league: h.ref } : null
}

/** "+ Follow": search ESPN for a team or a tournament; before anything is typed, the four the owner named. */
export function FootballFollowModal({ onClose }: EntityModalProps<'football-follow'>) {
  const [text, setText] = useState('')
  const query = useDebouncedValue(text.trim(), 300)
  const search = useFootballSearch(query)
  const follows = useFollows().data ?? []
  const follow = useFollow()
  const searching = query.length >= 2
  const hits: NewFollowInput[] = searching ? (search.data ?? []).map(followOf).filter((x): x is NewFollowInput => !!x) : [...SUGGESTIONS]
  const subtitle = (h: NewFollowInput) => (searching ? search.data?.find(x => x.ref === h.ref && x.kind === h.kind)?.subtitle : null) ?? (h.kind === 'team' ? 'Team' : 'Tournament')

  return (
    <ModalShell onClose={onClose} title="Follow a team or tournament" size="md">
      <div className="flex flex-col gap-3">
        <label className="relative block max-w-md">
          <span className="sr-only">Search teams and tournaments</span>
          <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-faint" />
          <input
            autoFocus value={text} onChange={e => setText(e.target.value)} maxLength={60}
            placeholder="Galatasaray, Premier League, Euro…" className="input pl-9"
          />
        </label>
        <SectionLabel>{searching ? 'Results' : 'Suggestions'}</SectionLabel>
        {searching && search.isLoading ? <SkeletonText lines={4} />
          : searching && search.isError ? <p className="text-body text-fg-muted">ESPN didn't answer. <button type="button" className="font-semibold text-accent-600" onClick={() => { void search.refetch() }}>Try again</button></p>
          : hits.length === 0 ? <p className="text-body text-fg-muted">No team or tournament called "{query}".</p>
          : (
            <ul className="-mx-1 flex flex-col">
              {hits.map(h => {
                const already = isFollowed(follows, h.kind, h.ref)
                return (
                  <li key={`${h.kind}:${h.ref}`} className="row gap-2.5">
                    <TeamLogo src={h.logo} kind={h.kind} size={24} />
                    <span className="min-w-0 flex-1">
                      <Truncate className="text-body font-medium text-fg">{h.name}</Truncate>
                      <Truncate className="text-meta text-fg-muted">{subtitle(h)}</Truncate>
                    </span>
                    {already ? <span className="shrink-0 text-meta text-fg-muted">Following</span> : (
                      <Button
                        size="sm" loading={follow.isPending && follow.variables?.input.ref === h.ref}
                        disabled={follow.isPending}
                        onClick={() => follow.mutate({ input: h, sortOrder: follows.length })}
                      >
                        Follow
                      </Button>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
      </div>
    </ModalShell>
  )
}

// ─── football-team ───────────────────────────────────────────────────────────

const OUTCOME_TONE: Record<'W' | 'D' | 'L', Tone> = { W: 'success', D: 'neutral', L: 'danger' }

/** A club: where it stands, its form, its next match and its squad by position. */
export function FootballTeamModal({ request, onClose }: EntityModalProps<'football-team'>) {
  const { teamId } = request
  // ESPN reads a club under any league ("all" gives its own); a squad only under a real one.
  const infoQ = useTeamInfo(request.league ?? 'all', teamId)
  const info = infoQ.data
  if (!info) {
    if (infoQ.isSuccess) return <ModalShell onClose={onClose} title="Can't open this club"><p className="text-body text-fg-2">ESPN has no page for this club.</p></ModalShell>
    return <EntityModalPending query={infoQ} what="club" onClose={onClose} />
  }
  return (
    <ModalShell
      onClose={onClose}
      title={<span className="flex min-w-0 items-center gap-2.5"><TeamLogo src={info.logo} size={28} /><Truncate>{info.name}</Truncate></span>}
      subtitle={<MetaLine items={[info.standing, info.record && `W-D-L ${info.record}`]} as="span" />}
      size="md"
    >
      <ErrorBoundary label="Club" action="football_team">
        <TeamBody teamId={teamId} name={info.name} logo={info.logo} squadLeague={info.defaultLeague ?? (request.league !== 'all' ? request.league ?? null : null)} espnUrl={info.espnUrl} />
      </ErrorBoundary>
    </ModalShell>
  )
}

function TeamBody({ teamId, name, logo, squadLeague, espnUrl }: { teamId: string; name: string; logo: string | null; squadLeague: string | null; espnUrl: string | null }) {
  const modal = useEntityModal()
  const followsQ = useFollows()
  const follows = followsQ.data ?? []
  const mine = follows.find(f => f.kind === 'team' && f.ref === teamId)
  const follow = useFollow()
  const results = useTeamResults(teamId)
  const fixtures = useTeamFixtures(teamId)
  const roster = useRoster(squadLeague, teamId)
  const planned = usePlannedTasks()
  const form = (results.data ?? []).filter(m => outcomeFor(m, teamId)).slice(0, 5)
  const next = (fixtures.data ?? []).find(m => m.state === 'pre' || m.state === 'in')

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {mine ? <SubscribeToggle follow={mine} /> : (
          <Button size="sm" loading={follow.isPending} onClick={() => follow.mutate({ input: { kind: 'team', ref: teamId, name, logo, league: squadLeague }, sortOrder: follows.length })}>
            Follow
          </Button>
        )}
        {espnUrl && (
          <a href={espnUrl} target="_blank" rel="noreferrer noopener" className="btn btn-ghost btn-sm">
            <ExternalLink aria-hidden className="h-4 w-4" />On ESPN
          </a>
        )}
      </div>

      {form.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <SectionLabel>Form</SectionLabel>
          <div className="flex gap-1.5">
            {[...form].reverse().map(m => {
              const o = outcomeFor(m, teamId)!
              return (
                <button key={m.id} type="button" onClick={() => m.league && modal.open({ kind: 'football-match', eventId: m.id, league: m.league.slug })}
                  aria-label={`${o === 'W' ? 'Won' : o === 'L' ? 'Lost' : 'Drew'} ${m.home.team.short} ${scoreText(m)} ${m.away.team.short}`}>
                  <TonePill tone={OUTCOME_TONE[o]} className="w-7 justify-center">{o}</TonePill>
                </button>
              )
            })}
          </div>
        </section>
      )}

      {next && (
        <section className="flex flex-col gap-1">
          <SectionLabel>Next · {formatWeekdayDate(osloParts(next.kickoff).date)}</SectionLabel>
          <div className="-mx-1"><MatchRow match={next} planned={planned.has(next.id)} /></div>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <SectionLabel>Squad</SectionLabel>
        {roster.isLoading ? <SkeletonText lines={6} />
          : roster.isError ? <p className="text-body text-fg-muted">The squad couldn't be read from ESPN.</p>
          : !roster.data?.length ? <p className="text-body text-fg-muted">ESPN has no squad for this club.</p>
          : squadGroups(roster.data).map(g => (
            <div key={g.group} className="flex flex-col">
              <h3 className="px-1 text-meta font-semibold text-fg-muted">{g.group}</h3>
              <ul className="-mx-1 flex flex-col">
                {g.players.map(p => (
                  <li key={p.id}>
                    <button type="button" className="row row-interactive w-full gap-2.5 text-left"
                      onClick={() => squadLeague && modal.open({ kind: 'football-player', teamId, league: squadLeague, playerId: p.id })}>
                      <span className="w-6 shrink-0 text-right text-meta tabular-nums text-fg-muted">{p.number ?? ''}</span>
                      <Truncate className="min-w-0 flex-1 text-body font-medium text-fg">{p.name}</Truncate>
                      {p.flag && <img src={p.flag} alt="" aria-hidden loading="lazy" referrerPolicy="no-referrer" className="h-3 w-[18px] shrink-0 rounded-[2px] object-cover" />}
                      {p.age != null && <span className="w-7 shrink-0 text-right text-meta tabular-nums text-fg-muted">{p.age}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
      </section>
    </div>
  )
}

// ─── football-player ─────────────────────────────────────────────────────────

export function FootballPlayerModal({ request, onClose }: EntityModalProps<'football-player'>) {
  const roster = useRoster(request.league, request.teamId)
  const p = roster.data?.find(x => x.id === request.playerId)
  if (!p) {
    if (roster.isSuccess) return <ModalShell onClose={onClose} title="Can't open this player"><p className="text-body text-fg-2">This player is no longer in the squad.</p></ModalShell>
    return <EntityModalPending query={roster} what="player" size="sm" onClose={onClose} />
  }
  const facts: [string, ReactNode][] = [
    ['Number', p.number],
    ['Position', p.position],
    ['Age', p.age != null ? (p.born ? `${p.age} · born ${formatDate(p.born)}` : p.age) : null],
    ['Nationality', p.nationality && (
      <span className="inline-flex items-center gap-1.5">
        {p.flag && <img src={p.flag} alt="" aria-hidden referrerPolicy="no-referrer" className="h-3 w-[18px] rounded-[2px] object-cover" />}
        {p.nationality}
      </span>
    )],
    ['Height', p.heightCm != null ? `${p.heightCm} cm` : null],
    ['Weight', p.weightKg != null ? `${p.weightKg} kg` : null],
  ]
  return (
    <ModalShell onClose={onClose} title={p.name} subtitle={p.group === 'Others' ? undefined : p.group.replace(/s$/, '')} size="sm">
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2">
        {facts.filter(([, v]) => v != null && v !== '').map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-meta text-fg-muted">{k}</dt>
            <dd className="text-body tabular-nums text-fg">{v}</dd>
          </div>
        ))}
      </dl>
    </ModalShell>
  )
}

// ─── football-match ──────────────────────────────────────────────────────────

/** A match: the score or kick-off, goals, the line-ups, the stadium — and Plan it. */
export function FootballMatchModal({ request, onClose }: EntityModalProps<'football-match'>) {
  const q = useMatchDetail(request.league, request.eventId)
  const modal = useEntityModal()
  const planIt = usePlanIt()
  const taskId = usePlannedTasks().get(request.eventId)
  const d = q.data
  if (!d) {
    if (q.isSuccess) return <ModalShell onClose={onClose} title="Can't open this match"><p className="text-body text-fg-2">ESPN has no details for this match.</p></ModalShell>
    return <EntityModalPending query={q} what="match" onClose={onClose} />
  }
  const m = d.match
  const { date, time } = osloParts(m.kickoff)
  const footer = taskId ? (
    <Button icon={<CalendarCheck />} onClick={() => modal.open({ kind: 'task', id: taskId })}>In your day</Button>
  ) : m.state === 'pre' && m.league ? (
    <Button variant="primary" icon={<CalendarPlus />} onClick={() => planIt(m)}>Plan it</Button>
  ) : undefined
  return (
    <ModalShell
      onClose={onClose}
      title={`${m.home.team.short} – ${m.away.team.short}`}
      subtitle={<MetaLine items={[m.league?.name, m.round]} as="span" />}
      size="md"
      footer={footer && <div className="flex justify-end">{footer}</div>}
    >
      <ErrorBoundary label="Match" action="football_match">
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
            <TeamSide side={m.home} league={m.league?.slug} />
            <div className="flex flex-col items-center text-center">
              {scoreText(m)
                ? <span className={cx('text-kpi tabular-nums', m.state === 'in' ? 'text-success' : 'text-fg')}>{scoreText(m)}</span>
                : <span className="text-head tabular-nums text-fg">{m.timeValid ? time : '–'}</span>}
              <span className="text-meta text-fg-muted">
                {m.state === 'in' ? <span className="text-success">{m.clock || 'Live'}</span>
                  : m.state === 'post' ? 'Full time'
                  : m.state === 'postponed' ? 'Postponed'
                  : m.state === 'canceled' ? 'Cancelled'
                  : m.timeValid ? formatWeekdayDate(date) : `${formatWeekdayDate(date)} · time not set`}
              </span>
            </div>
            <TeamSide side={m.away} league={m.league?.slug} />
          </div>

          {m.goals.length > 0 && <Goals match={m} />}

          <MetaLine className="text-meta text-fg-muted" items={[
            m.venue && (m.city ? `${m.venue}, ${m.city}` : m.venue),
            d.attendance && `${d.attendance.toLocaleString('en-GB')} watching`,
          ]} />

          {d.lineups.length > 0 ? (
            <div className="grid grid-cols-2 gap-3">
              {(['home', 'away'] as const).map(s => {
                const l = d.lineups.find(x => x.side === s)
                return l ? <Lineup key={s} lineup={l} /> : <div key={s} />
              })}
            </div>
          ) : null}
        </div>
      </ErrorBoundary>
    </ModalShell>
  )
}

function TeamSide({ side, league }: { side: FbSide; league: string | undefined }) {
  const modal = useEntityModal()
  return (
    <button type="button" onClick={() => modal.open({ kind: 'football-team', teamId: side.team.id, league })}
      className="flex min-w-0 flex-col items-center gap-1.5 rounded-row p-1 text-center hover:bg-surface-hover">
      <TeamLogo src={side.team.logo} size={44} />
      <Truncate className={cx('max-w-full text-body text-fg', side.winner ? 'font-semibold' : 'font-medium')}>{side.team.name}</Truncate>
    </button>
  )
}

function Goals({ match }: { match: FbMatch }) {
  return (
    <ul className="flex flex-col gap-1">
      {match.goals.map((g, i) => {
        const home = g.teamId === match.home.team.id
        return (
          <li key={i} className={cx('flex items-baseline gap-2 text-body', home ? 'justify-start' : 'flex-row-reverse text-right')}>
            <span className="w-9 shrink-0 tabular-nums text-fg-muted">{g.minute}</span>
            <Truncate className="min-w-0 text-fg">{g.player || 'Goal'}{g.kind !== 'goal' ? ` (${g.kind === 'penalty' ? 'pen' : 'own goal'})` : ''}</Truncate>
          </li>
        )
      })}
    </ul>
  )
}

function Lineup({ lineup }: { lineup: FbLineup }) {
  const person = (p: FbLineup['starters'][number], i: number) => (
    <li key={i} className="flex items-baseline gap-2 text-body">
      <span className="w-6 shrink-0 text-right tabular-nums text-fg-muted">{p.number ?? ''}</span>
      <Truncate className="min-w-0 text-fg">{p.name}</Truncate>
    </li>
  )
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <SectionLabel>{lineup.formation ?? 'Line-up'}</SectionLabel>
      <ul className="flex flex-col gap-0.5">{lineup.starters.map(person)}</ul>
      {lineup.bench.length > 0 && (
        <Disclosure>
          <DisclosureButton className="group mt-1 flex items-center gap-1 self-start text-meta font-semibold text-fg-muted hover:text-fg">
            Bench · {lineup.bench.length}
            <ChevronDown aria-hidden className="h-3.5 w-3.5 transition-transform group-data-[open]:rotate-180" />
          </DisclosureButton>
          <DisclosurePanel as="ul" className="flex flex-col gap-0.5">{lineup.bench.map(person)}</DisclosurePanel>
        </Disclosure>
      )}
    </div>
  )
}

