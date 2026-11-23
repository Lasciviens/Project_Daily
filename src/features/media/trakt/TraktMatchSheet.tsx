import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { ErrorNotice } from '../../../shared/components/ErrorNotice'
import { useDebouncedValue } from '../../../shared/hooks/useDebouncedValue'
import { ModalShell } from '../../../shared/modals/ModalShell'
import { Button, Skeleton } from '../../../shared/ui'
import { Truncate } from '../../../shared/ui/Truncate'
import { posterUrl } from '../../../integrations/tmdb/client'
import { useSearchTitles } from '../hooks/useTMDB'
import type { TMDBSearchMovie, TMDBSearchTV } from '../types'
import type { ManualMatch, MatchKind } from './traktMatchApi'
import { useSaveTraktMatch } from './useTraktMatch'

// Picks the TMDB title for one Trakt title that has no TMDB id (docs/features/media.md → Trakt matching): a title + year
// search through TMDB, a short list with poster, year and overview, and Save. Everything TMDB sends is shown as text.

export interface MatchTarget { kind: MatchKind; trakt_id: number; title: string; year: number | null; previous: ManualMatch | null; /** The TMDB title the old pick points at (Change). */ previousName?: string }

const nameOf = (r: TMDBSearchMovie | TMDBSearchTV) => ('title' in r ? r.title : r.name)
const yearOf = (r: TMDBSearchMovie | TMDBSearchTV) => {
  const d = 'release_date' in r ? r.release_date : r.first_air_date
  return d ? Number(d.slice(0, 4)) || null : null
}

function Pick({ r, selected, onSelect }: { r: TMDBSearchMovie | TMDBSearchTV; selected: boolean; onSelect: () => void }) {
  const year = yearOf(r)
  return (
    <button
      type="button" onClick={onSelect} aria-pressed={selected}
      className={`flex w-full items-start gap-3 rounded-control border px-2 py-2 text-left ${selected ? 'border-accent bg-surface-2' : 'border-line'}`}
    >
      {r.poster_path
        ? <img src={posterUrl(r.poster_path, 'w92')} alt="" loading="lazy" className="h-16 w-11 shrink-0 rounded-control bg-surface-2 object-cover" />
        : <span aria-hidden className="h-16 w-11 shrink-0 rounded-control bg-surface-2" />}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <Truncate className="text-ui font-semibold text-fg">{`${nameOf(r)}${year ? ` (${year})` : ''}`}</Truncate>
        {r.overview ? <Truncate lines={2} className="text-meta text-fg-2">{r.overview}</Truncate> : <span className="text-meta text-fg-muted">No description</span>}
      </span>
    </button>
  )
}

export function TraktMatchSheet({ target, onClose }: { target: MatchTarget | null; onClose: () => void }) {
  return (
    <ModalShell open={!!target} onClose={onClose} title={target?.previous ? 'Change match' : 'Pick the match'} subtitle={target ? `${target.title}${target.year ? ` (${target.year})` : ''} on Trakt` : undefined} size="md">
      {target && <Body key={`${target.kind}:${target.trakt_id}`} target={target} onClose={onClose} />}
    </ModalShell>
  )
}

function Body({ target, onClose }: { target: MatchTarget; onClose: () => void }) {
  const [text, setText] = useState(target.title)
  const [selected, setSelected] = useState<number | null>(null)
  const q = useDebouncedValue(text, 400)
  const type = target.kind === 'movie' ? 'movie' : 'tv'
  const search = useSearchTitles(type, q)
  const save = useSaveTraktMatch()
  const results = useMemo(() => {
    const all = (search.data?.pages ?? []).flatMap(p => (Array.isArray(p.results) ? p.results : []))
    // The year Trakt gave comes first; the rest keep TMDB's order.
    if (target.year == null) return all
    return [...all].sort((a, b) => Number(yearOf(b) === target.year) - Number(yearOf(a) === target.year))
  }, [search.data, target.year])
  const shown = results.slice(0, 8)
  const picked = results.find(r => r.id === selected) ?? null

  const submit = async () => {
    if (!picked) return
    try {
      await save.mutateAsync({ kind: target.kind, trakt_id: target.trakt_id, tmdb_id: picked.id, pickTitle: nameOf(picked), previous: target.previous })
      onClose()
    } catch { /* toasted by the hook */ }
  }

  return (
    <div className="flex flex-col gap-3">
      {target.previous && target.previousName && (
        <p className="rounded-control bg-surface-2 px-3 py-2 text-meta text-fg" data-tone="warn">
          {target.previousName} may leave your library at the next sync, because Trakt doesn't know it by that name. Your watches stay on Trakt.
        </p>
      )}
      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted" />
        <input autoFocus className="input pl-9" value={text} onChange={e => { setText(e.target.value); setSelected(null) }}
          placeholder={`Search a ${target.kind === 'movie' ? 'movie' : 'show'} on TMDB…`} aria-label="Search TMDB by title" />
      </div>
      {search.isError && <ErrorNotice where="Settings → Trakt → pick a match" title="TMDB search failed." error={search.error} onRetry={() => search.refetch()} />}
      {search.isLoading && <div className="flex flex-col gap-2"><Skeleton className="h-[72px]" /><Skeleton className="h-[72px]" /></div>}
      {!search.isLoading && !search.isError && q.trim() && shown.length === 0 && <p className="text-meta text-fg-muted">Nothing found — try fewer words.</p>}
      <div className="flex flex-col gap-2">
        {shown.map(r => <Pick key={r.id} r={r} selected={r.id === selected} onSelect={() => setSelected(r.id)} />)}
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={save.isPending}>Cancel</Button>
        <Button variant="primary" onClick={submit} loading={save.isPending} disabled={!picked}>Save match</Button>
      </div>
    </div>
  )
}
