import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ErrorNotice } from '../../../shared/components/ErrorNotice'
import { qk } from '../../../shared/query/keys'
import { STALE } from '../../../shared/query/stale'
import { Button, Skeleton, TonePill } from '../../../shared/ui'
import { Truncate } from '../../../shared/ui/Truncate'
import { getBasic } from '../api/tmdbApi'
import { TraktMatchSheet, type MatchTarget } from './TraktMatchSheet'
import type { ManualMatch, UnmatchedTitle } from './traktMatchApi'
import { useRemoveTraktMatch, useTraktMatches, useTraktUnmatched } from './useTraktMatch'

// Settings → Subscriptions → Trakt: the titles Trakt has that this app could not match to TMDB (no TMDB id on Trakt), each with
// "Pick match", and the matches already made. The save is read by the sync (docs/features/media.md → Trakt matching).

const label = (title: string, year: number | null) => `${title}${year ? ` (${year})` : ''}`
const kindWord = (k: 'movie' | 'show') => (k === 'movie' ? 'Movie' : 'Show')

/** The TMDB title a saved match points at (a name for the row; the id alone when TMDB does not answer). */
function MatchedTo({ m }: { m: ManualMatch }) {
  const q = useQuery({
    queryKey: qk.media.tmdbQuery('basic', m.kind === 'movie' ? 'movie' : 'tv', m.tmdb_id),
    queryFn: () => getBasic(m.kind === 'movie' ? 'movie' : 'tv', m.tmdb_id),
    staleTime: STALE.day, retry: false,
  })
  const d = q.data
  const name = d ? (d.title ?? d.name ?? '') : ''
  const year = d ? (d.release_date ?? d.first_air_date ?? '').slice(0, 4) : ''
  return <>{name ? `${name}${year ? ` (${year})` : ''}` : `TMDB ${m.tmdb_id}`}</>
}

function Row({ title, sub, children }: { title: string; sub: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex min-h-[44px] items-center gap-2 rounded-control border border-line px-3 py-1.5">
      <span className="flex min-w-0 flex-1 flex-col">
        <Truncate className="text-ui text-fg">{title}</Truncate>
        <Truncate className="text-micro text-fg-muted">{sub}</Truncate>
      </span>
      <span className="flex shrink-0 gap-1">{children}</span>
    </li>
  )
}

export function TraktMatchList() {
  const unmatched = useTraktUnmatched(true)
  const matches = useTraktMatches(true)
  const removal = useRemoveTraktMatch()
  const [target, setTarget] = useState<MatchTarget | null>(null)

  const made = new Map((matches.data ?? []).map(m => [`${m.kind}:${m.trakt_id}`, m]))
  // A title already matched waits for the next sync to leave the list; it shows once, in "Matched by you".
  const open = (unmatched.data ?? []).filter(u => !u.has_tmdb && !made.has(`${u.kind}:${u.trakt_id}`))
  const retried = (unmatched.data ?? []).filter(u => u.has_tmdb).length
  const titleOf = (m: ManualMatch) => (unmatched.data ?? []).find(u => u.kind === m.kind && u.trakt_id === m.trakt_id)
  const matchList = matches.data ?? []

  if (unmatched.isLoading || matches.isLoading) return <Skeleton className="h-11 max-w-md" />
  if (unmatched.isError || matches.isError) return <ErrorNotice where="Settings → Trakt → titles to match" title="The titles to match could not be read." error={unmatched.error ?? matches.error} onRetry={() => { void unmatched.refetch(); void matches.refetch() }} />
  if (!open.length && !matchList.length && !retried) return null

  const pick = (u: UnmatchedTitle, previous: ManualMatch | null) => setTarget({ kind: u.kind, trakt_id: u.trakt_id, title: u.title, year: u.year, previous })

  return (
    <details className="group rounded-control border border-line px-3 py-2 open:bg-surface-2">
      <summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-2 text-meta">
        <span className="min-w-0 flex-1 text-fg">Titles to match</span>
        {open.length > 0 && <TonePill tone="warn">{open.length} to match</TonePill>}
        {matchList.length > 0 && <TonePill tone="success">{matchList.length} matched</TonePill>}
      </summary>
      <div className="flex flex-col gap-3 pb-1">
        <p className="text-meta text-fg-muted">Trakt has no TMDB id for these, so the app never guessed. Pick the right title; the next sync (every 30 minutes) links it with its watches, ratings and watchlist.</p>
        {open.length > 0 && (
          <ul className="flex flex-col gap-1.5">
            {open.map(u => (
              <Row key={u.id} title={label(u.title, u.year)} sub={`${kindWord(u.kind)} on Trakt`}>
                <Button size="sm" variant="secondary" onClick={() => pick(u, null)}>Pick match</Button>
              </Row>
            ))}
          </ul>
        )}
        {matchList.length > 0 && (
          <section className="flex flex-col gap-1.5">
            <h3 className="section-label">Matched by you</h3>
            <ul className="flex flex-col gap-1.5">
              {matchList.map(m => {
                const t = titleOf(m)
                const name = t ? label(t.title, t.year) : `${kindWord(m.kind)} #${m.trakt_id} on Trakt`
                return (
                  <Row key={m.id} title={name} sub={<>→ <MatchedTo m={m} /></>}>
                    {t && <Button size="sm" variant="secondary" onClick={() => pick(t, m)}>Change</Button>}
                    <Button size="sm" variant="ghost" onClick={() => void removal.remove(m, name)} disabled={removal.busy}>Remove</Button>
                  </Row>
                )
              })}
            </ul>
          </section>
        )}
        {retried > 0 && <p className="text-micro text-fg-muted">{retried} more {retried === 1 ? 'title has' : 'titles have'} a TMDB id and {retried === 1 ? 'is' : 'are'} retried by the next sync.</p>}
      </div>
      <TraktMatchSheet target={target} onClose={() => setTarget(null)} />
    </details>
  )
}
