import { useState } from 'react'
import { Search } from 'lucide-react'
import { SegmentedControl, Skeleton, Truncate } from '../../../shared/ui'
import type { FollowKind } from '../api/followsApi'
import { useToggleFollow } from '../hooks/useFollows'
import { useSourceSearch, type SourceKind } from '../hooks/useSmartLists'

const KINDS: { value: SourceKind; label: string; hint: string; examples: string[] }[] = [
  { value: 'collection', label: 'Franchise', hint: 'A film series, in order', examples: ['Harry Potter', 'The Lord of the Rings', 'Dune', 'James Bond'] },
  { value: 'company', label: 'Studio', hint: 'Every film a studio made', examples: ['Marvel Studios', 'Pixar', 'Studio Ghibli', 'A24'] },
  { value: 'keyword', label: 'Keyword', hint: 'Every film tagged with it — a whole universe', examples: ['marvel cinematic universe', 'dc extended universe', 'christmas'] },
  { value: 'person', label: 'Person', hint: 'A director’s or an actor’s films', examples: ['Christopher Nolan', 'Denis Villeneuve'] },
]

/**
 * The "Fill automatically" half of New list: pick a franchise, studio, keyword
 * or person on TMDB and every film comes along (and new ones later — it is
 * also followed, so new titles and trailers show under What's new).
 */
export function AutoListPicker({ onCreated }: { onCreated: (kind: FollowKind, tmdbId: number) => void }) {
  const [kind, setKind] = useState<SourceKind>('company')
  const [query, setQuery] = useState('')
  const results = useSourceSearch(kind, query)
  const add = useToggleFollow()
  const meta = KINDS.find(k => k.value === kind)!

  async function pick(r: { id: number; name: string; known_for_department?: string }) {
    const k: FollowKind = kind === 'person' ? (r.known_for_department === 'Directing' ? 'director' : 'actor') : kind
    try {
      await add.mutateAsync({ kind: k, tmdbId: r.id, name: r.name })
      onCreated(k, r.id)
    } catch { /* toasted */ }
  }

  return (
      <div className="flex flex-col gap-3">
        <SegmentedControl<SourceKind> value={kind} onChange={k => { setKind(k); setQuery('') }} options={KINDS.map(k => ({ value: k.value, label: k.label }))} />
        <p className="text-meta text-fg-muted">{meta.hint}.</p>
        <label className="relative w-full max-w-md">
          <span className="sr-only">Search {meta.label.toLowerCase()}</span>
          <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-faint" />
          <input autoFocus className="input pl-9" value={query} onChange={e => setQuery(e.target.value)} placeholder={`Search a ${meta.label.toLowerCase()}…`} />
        </label>
        {query.trim().length < 2 ? (
          <div className="flex flex-wrap gap-1.5">
            {meta.examples.map(e => <button key={e} type="button" className="chip press-feedback min-h-[44px] sm:min-h-[36px]" onClick={() => setQuery(e)}>{e}</button>)}
          </div>
        ) : results.isLoading ? (
          <div className="space-y-1.5">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-11 w-full" />)}</div>
        ) : (results.data ?? []).length === 0 ? (
          <p className="text-body text-fg-muted">Nothing found on TMDB.</p>
        ) : (
          <ul className="-mx-1 flex flex-col">
            {(results.data ?? []).map(r => (
              <li key={r.id}>
                <button type="button" disabled={add.isPending} onClick={() => { void pick(r) }} className="row row-interactive w-full text-left">
                  <span className="min-w-0 flex-1">
                    <Truncate className="block text-body font-medium text-fg">{r.name}</Truncate>
                    <span className="block text-micro text-fg-muted">
                      {kind === 'person' ? (r.known_for_department === 'Directing' ? 'Director' : r.known_for_department ?? 'Person') : kind === 'company' ? (r.origin_country || 'Studio') : meta.label}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
  )
}
