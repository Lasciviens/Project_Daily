import { BellRing, Play, RefreshCw } from 'lucide-react'
import { posterUrl } from '../../../integrations/tmdb/client'
import { useEntityModal } from '../../../shared/modals'
import { Button, SectionLabel, Truncate } from '../../../shared/ui'
import { formatDate } from '../../../shared/utils/dateFormat'
import { useCheckFollows, useFollowEvents, useFollows, useMarkFollowEventsSeen } from '../hooks/useFollows'

/** What's new in what you follow (self-filling lists and Follows): new titles and new trailers, checked daily. */
export function FollowingPanel() {
  const { data: follows = [] } = useFollows()
  const { data: events = [] } = useFollowEvents()
  const check = useCheckFollows()
  const seen = useMarkFollowEventsSeen()
  const modal = useEntityModal()
  const unseen = events.filter(e => !e.seen_at)
  const name = new Map(follows.map(f => [f.id, f.name]))

  if (follows.length === 0) {
    return (
      <section className="card p-3">
        <SectionLabel className="mb-1">What’s new</SectionLabel>
        <p className="text-meta text-fg-muted">Make a list that fills itself (or Follow a franchise, director, studio or actor on a movie’s page): new titles and trailers show up here.</p>
      </section>
    )
  }

  return (
    <section className="card flex flex-col gap-3 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionLabel>What’s new · {unseen.length} unseen</SectionLabel>
        <div className="flex gap-1">
          {unseen.length > 0 && <Button size="sm" variant="ghost" onClick={() => seen.mutate(unseen.map(e => e.id))}>Mark {unseen.length} seen</Button>}
          <Button size="sm" variant="ghost" icon={<RefreshCw />} loading={check.isPending} onClick={() => check.mutate()}>Check now</Button>
        </div>
      </div>


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
