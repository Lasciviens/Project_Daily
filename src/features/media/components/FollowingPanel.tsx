import { BellRing, Play, RefreshCw, X } from 'lucide-react'
import { posterUrl } from '../../../integrations/tmdb/client'
import { useEntityModal } from '../../../shared/modals'
import { Button, SectionLabel, Truncate } from '../../../shared/ui'
import { formatDate } from '../../../shared/utils/dateFormat'
import { useCheckFollows, useFollowEvents, useFollows, useLinkFollowList, useMarkFollowEventsSeen, useToggleFollow } from '../hooks/useFollows'
import { useTraktLists } from '../trakt/useTraktExtras'
import { useTraktStatus } from '../trakt/useTrakt'

const KIND: Record<string, string> = { collection: 'Franchise', company: 'Studio', director: 'Director', actor: 'Actor' }

/** What you follow, and what's new there: new titles and new trailers (checked daily). */
export function FollowingPanel() {
  const { data: follows = [] } = useFollows()
  const { data: events = [] } = useFollowEvents()
  const { data: trakt } = useTraktStatus()
  const lists = useTraktLists(follows.length > 0)
  const toggle = useToggleFollow()
  const link = useLinkFollowList()
  const check = useCheckFollows()
  const seen = useMarkFollowEventsSeen()
  const modal = useEntityModal()
  const unseen = events.filter(e => !e.seen_at)
  const name = new Map(follows.map(f => [f.id, f.name]))

  if (follows.length === 0) {
    return (
      <section className="card p-3">
        <SectionLabel className="mb-1">Following</SectionLabel>
        <p className="text-meta text-fg-muted">Follow a franchise, director, studio or actor from a movie’s page (Follow). New titles and trailers show up here.</p>
      </section>
    )
  }

  return (
    <section className="card flex flex-col gap-3 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionLabel>Following · {follows.length}</SectionLabel>
        <div className="flex gap-1">
          {unseen.length > 0 && <Button size="sm" variant="ghost" onClick={() => seen.mutate(unseen.map(e => e.id))}>Mark {unseen.length} seen</Button>}
          <Button size="sm" variant="ghost" icon={<RefreshCw />} loading={check.isPending} onClick={() => check.mutate()}>Check now</Button>
        </div>
      </div>

      <ul className="flex flex-col gap-1">
        {follows.map(f => (
          <li key={f.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-meta">
            <span className="min-w-[12rem] flex-1">
              <Truncate className="font-semibold text-fg">{f.name}</Truncate>
              <span className="block text-micro text-fg-muted">{KIND[f.kind]}{f.last_checked_at ? ` · checked ${formatDate(f.last_checked_at)}` : ''}</span>
            </span>
            {trakt?.connected && (
              <select
                aria-label={`Trakt list for ${f.name}`}
                className="input h-9 w-auto max-w-[14rem] py-0 text-meta"
                value={f.trakt_list_id ?? ''}
                onChange={e => link.mutate({ id: f.id, listId: e.target.value ? Number(e.target.value) : null })}
              >
                <option value="">No list</option>
                {(lists.data ?? []).map(l => <option key={l.id} value={l.id}>Add to “{l.name}”</option>)}
              </select>
            )}
            <button type="button" aria-label={`Stop following ${f.name}`} onClick={() => toggle.mutate({ followId: f.id, kind: f.kind, tmdbId: f.tmdb_id, name: f.name })} className="icon-btn">
              <X aria-hidden className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>

      {events.length > 0 && (
        <ul className="grid grid-cols-1 gap-1 @[40rem]:grid-cols-2">
          {events.slice(0, 20).map(e => (
            <li key={e.id} className={`flex items-center gap-2 rounded-row px-1 py-1 ${e.seen_at ? 'opacity-70' : 'bg-accent-50'}`}>
              <button type="button" onClick={() => modal.open({ kind: 'media', tmdbId: e.tmdb_id, mediaType: 'movie' })} className="flex min-h-[44px] min-w-0 flex-1 items-center gap-2 text-left">
                <img src={posterUrl(e.poster_path, 'w92')} alt="" loading="lazy" className="h-10 w-7 shrink-0 rounded bg-surface-2 object-cover" />
                <span className="min-w-0">
                  <Truncate className="text-meta font-medium text-fg">{e.title}</Truncate>
                  <span className="flex items-center gap-1 text-micro text-fg-muted">
                    <BellRing aria-hidden className="h-3 w-3" />
                    {e.kind === 'trailer' ? 'New trailer' : 'New title'} · {name.get(e.follow_id) ?? ''}{e.release_date ? ` · ${formatDate(e.release_date)}` : ''}
                  </span>
                </span>
              </button>
              {e.video_key && (
                <a href={`https://www.youtube.com/watch?v=${e.video_key}`} target="_blank" rel="noopener noreferrer" className="icon-btn" aria-label={`Watch the trailer for ${e.title}`}>
                  <Play aria-hidden className="h-4 w-4" />
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
