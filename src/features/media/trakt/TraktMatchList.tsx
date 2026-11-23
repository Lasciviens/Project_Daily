import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { ErrorNotice } from '../../../shared/components/ErrorNotice'
import { qk } from '../../../shared/query/keys'
import { STALE } from '../../../shared/query/stale'
import { Button, IconButton, Skeleton, TonePill } from '../../../shared/ui'
import { Truncate } from '../../../shared/ui/Truncate'
import { getBasic } from '../api/tmdbApi'
import { TraktMatchSheet, type MatchTarget } from './TraktMatchSheet'
import { PICK_NOT_USED } from './traktManualMatch'
import type { ManualMatch, UnmatchedTitle } from './traktMatchApi'
import { useRemoveTraktMatch, useTraktMatches, useTraktUnmatched } from './useTraktMatch'

// Settings → Subscriptions → Trakt: the titles Trakt has that this app could not match to TMDB (no TMDB id on Trakt), each with
// "Pick match", and the matches already made. The save is read by the sync (docs/features/media.md → Trakt matching).

const label = (title: string, year: number | null) => `${title}${year ? ` (${year})` : ''}`
const kindWord = (k: 'movie' | 'show') => (k === 'movie' ? 'Movie' : 'Show')
const RETRIED_SHOWN = 5

function Row({ title, sub, note, children }: { title: string; sub: React.ReactNode; note?: string; children: React.ReactNode }) {
  return (
    <li className="flex flex-col gap-0.5 rounded-control border border-line px-3 py-1.5">
      <div className="flex items-center gap-2">
        <span className="flex min-w-0 flex-1 flex-col">
          <Truncate className="text-ui text-fg">{title}</Truncate>
          <Truncate lines={2} className="text-micro text-fg-muted">{sub}</Truncate>
        </span>
        <span className="flex shrink-0 items-center gap-1">{children}</span>
      </div>
      {note && <p className="text-micro text-fg-muted">{note}</p>}
    </li>
  )
}

/**
 * One saved pick. The row is named after the TMDB title it points at (the Trakt name is not kept once the sync has linked it);
 * the second line leads with the year, then says where it stands: waiting for the sync, linked, or why the pick was not used.
 */
function MatchedRow({ m, trakt, onChange, onRemove, busy }: {
  m: ManualMatch; trakt: UnmatchedTitle | undefined
  onChange: (t: MatchTarget) => void; onRemove: (name: string) => void; busy: boolean
}) {
  const q = useQuery({
    queryKey: qk.media.tmdbQuery('basic', m.kind === 'movie' ? 'movie' : 'tv', m.tmdb_id),
    queryFn: () => getBasic(m.kind === 'movie' ? 'movie' : 'tv', m.tmdb_id),
    staleTime: STALE.day, retry: false,
  })
  const d = q.data
  const name = d ? (d.title ?? d.name ?? '') || `TMDB ${m.tmdb_id}` : `TMDB ${m.tmdb_id}`
  const year = d ? (d.release_date ?? d.first_air_date ?? '').slice(0, 4) : ''
  const refused = trakt?.reason === PICK_NOT_USED
  const state = refused ? PICK_NOT_USED : trakt ? 'Waiting for sync' : 'Linked'
  return (
    <Row title={name} sub={[year, state].filter(Boolean).join(' · ')} note="Changes here don't go to Trakt for this title — change it on Trakt.">
      <Button size="sm" variant="secondary" onClick={() => onChange({ kind: m.kind, trakt_id: m.trakt_id, title: trakt?.title ?? name, year: trakt?.year ?? (Number(year) || null), previous: m, previousName: name })}>Change</Button>
      <IconButton size="sm" label={`Remove the match for ${name}`} onClick={() => onRemove(name)} disabled={busy}><Trash2 aria-hidden /></IconButton>
    </Row>
  )
}

export function TraktMatchList() {
  const unmatched = useTraktUnmatched(true)
  const matches = useTraktMatches(true)
  const removal = useRemoveTraktMatch()
  const [target, setTarget] = useState<MatchTarget | null>(null)

  const made = new Map((matches.data ?? []).map(m => [`${m.kind}:${m.trakt_id}`, m]))
  // A title already matched shows once, in "Matched by you" (its unmatched row stays until the next sync).
  const open = (unmatched.data ?? []).filter(u => !u.has_tmdb && !made.has(`${u.kind}:${u.trakt_id}`))
  const retried = (unmatched.data ?? []).filter(u => u.has_tmdb)
  const matchList = matches.data ?? []

  if (unmatched.isLoading || matches.isLoading) return <Skeleton className="h-11 max-w-md" />
  if (unmatched.isError || matches.isError) return <ErrorNotice where="Settings → Trakt → titles to match" title="The titles to match could not be read." error={unmatched.error ?? matches.error} onRetry={() => { void unmatched.refetch(); void matches.refetch() }} />
  if (!open.length && !matchList.length && !retried.length) return null

  return (
    <details className="group rounded-control border border-line px-3 py-2 open:bg-surface-2">
      <summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-2 text-meta">
        <span className="min-w-0 flex-1 text-fg">Titles to match</span>
        {open.length > 0 && <TonePill tone="warn">{open.length} to match</TonePill>}
        {matchList.length > 0 && <TonePill tone="success">{matchList.length} matched</TonePill>}
      </summary>
      <div className="flex flex-col gap-3 pb-1">
        <p className="text-meta text-fg-muted">Trakt doesn't say which TMDB title these are. Pick one; the next sync links it.</p>
        {open.length > 0 && (
          <ul className="flex flex-col gap-1.5">
            {open.map(u => (
              <Row key={u.id} title={label(u.title, u.year)} sub={`${kindWord(u.kind)} on Trakt`}>
                <Button size="sm" variant="secondary" onClick={() => setTarget({ kind: u.kind, trakt_id: u.trakt_id, title: u.title, year: u.year, previous: null })}>Pick match</Button>
              </Row>
            ))}
          </ul>
        )}
        {matchList.length > 0 && (
          <section className="flex flex-col gap-1.5">
            <h3 className="section-label">Matched by you</h3>
            <ul className="flex flex-col gap-1.5">
              {matchList.map(m => (
                <MatchedRow key={m.id} m={m} trakt={(unmatched.data ?? []).find(u => u.kind === m.kind && u.trakt_id === m.trakt_id)}
                  onChange={setTarget} onRemove={name => void removal.remove(m, name)} busy={removal.busy} />
              ))}
            </ul>
          </section>
        )}
        {retried.length > 0 && (
          <section className="flex flex-col gap-1">
            <h3 className="section-label">Retried by the next sync</h3>
            <ul className="flex flex-col gap-0.5 text-micro text-fg-muted">
              {retried.slice(0, RETRIED_SHOWN).map(u => <li key={u.id}><Truncate>{`${label(u.title, u.year)} — ${u.reason ?? 'lookup failed'}`}</Truncate></li>)}
              {retried.length > RETRIED_SHOWN && <li>…and {retried.length - RETRIED_SHOWN} more</li>}
            </ul>
          </section>
        )}
      </div>
      <TraktMatchSheet target={target} onClose={() => setTarget(null)} />
    </details>
  )
}
