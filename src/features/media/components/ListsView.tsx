import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ListPlus, ListVideo, Trash2, X } from 'lucide-react'
import { posterUrl } from '../../../integrations/tmdb/client'
import { useEntityModal } from '../../../shared/modals'
import { Button, EmptyState, Skeleton, Truncate } from '../../../shared/ui'
import { useTmdbBasic } from '../hooks/useTMDB'
import { useTraktStatus } from '../trakt/useTrakt'
import { useChangeTraktList, useDeleteTraktList, useTraktListItems, useTraktLists } from '../trakt/useTraktExtras'
import type { TraktListItem } from '../trakt/traktApi'
import type { MediaType } from '../types'
import { NewListDialog } from './NewListDialog'
import { FollowingPanel } from './FollowingPanel'

function ListTile({ item, onOpen, onRemove }: { item: TraktListItem; onOpen: () => void; onRemove: () => void }) {
  const type = item.type === 'show' ? 'tv' : 'movie'
  // Posters come from the library when the title is known; the rest from TMDB, once each.
  const { data } = useTmdbBasic(type, item.tmdb, !item.posterPath)
  const poster = item.posterPath ?? data?.poster_path ?? null
  return (
    <li className="relative">
      <button type="button" onClick={onOpen} className="group flex w-full min-w-0 flex-col text-left">
        <img src={posterUrl(poster, 'w185')} alt="" loading="lazy" decoding="async" className="aspect-[2/3] w-full rounded-md bg-surface-2 object-cover group-hover:brightness-90" />
        <Truncate className="mt-1 text-meta font-medium text-fg">{item.title}</Truncate>
        <span className="text-micro tabular-nums text-fg-muted">{item.type === 'show' ? 'TV' : 'Movie'}{item.year ? ` · ${item.year}` : ''}</span>
      </button>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${item.title} from this list`}
        className="absolute right-1 top-1 grid h-7 w-7 place-items-center rounded-full bg-scrim/60 text-white hover:bg-scrim/80"
      >
        <X aria-hidden className="h-3.5 w-3.5" />
      </button>
    </li>
  )
}

/** Your Trakt personal lists: pick one, see its titles, add a list, remove titles. */
export function ListsView({ onOpenDetail }: { onOpenDetail: (id: number, type: MediaType) => void }) {
  const { data: trakt, isLoading: statusLoading } = useTraktStatus()
  const lists = useTraktLists()
  const [picked, setPicked] = useState<number | null>(null)
  const [naming, setNaming] = useState(false)
  const current = (lists.data ?? []).find(l => l.id === picked) ?? lists.data?.[0] ?? null
  const items = useTraktListItems(current?.id ?? null)
  const change = useChangeTraktList()
  const del = useDeleteTraktList()
  const modal = useEntityModal()

  if (statusLoading) return <Skeleton className="h-40 w-full" />
  if (!trakt?.connected) {
    return (
      <section className="@container flex flex-col gap-3">
      <FollowingPanel />
      <EmptyState
        icon={<ListVideo />}
        title="Lists live on Trakt"
        description="Connect Trakt to make lists (franchises, comfort shows, to-watch-with-friends). They stay in sync with trakt.tv."
        action={<Link to="/settings?tab=subscriptions" className="btn-primary btn-sm">Connect Trakt</Link>}
        bordered
      />
      </section>
    )
  }

  async function deleteList() {
    if (!current) return
    const ok = await modal.confirm({ title: `Delete “${current.name}”?`, message: 'The list is deleted on Trakt too. The titles stay in your library.', confirmLabel: 'Delete list', destructive: true })
    if (ok) { del.mutate(current.id); setPicked(null) }
  }

  return (
    <section className="@container flex flex-col gap-3">
      <FollowingPanel />
      {naming && <NewListDialog onClose={() => setNaming(false)} />}
      <div className="flex items-center gap-2">
        <div role="tablist" aria-label="Lists" className="scroll-x flex min-w-0 flex-1 gap-1 pb-1">
          {lists.isLoading && <Skeleton className="h-9 w-40" />}
          {(lists.data ?? []).map(l => (
            <button
              key={l.id}
              type="button"
              role="tab"
              aria-selected={current?.id === l.id}
              onClick={() => setPicked(l.id)}
              className="pill-tab press-feedback shrink-0"
            >
              {l.name} <span className="ml-1 text-micro tabular-nums opacity-70">{l.itemCount}</span>
            </button>
          ))}
        </div>
        <Button size="sm" icon={<ListPlus />} onClick={() => setNaming(true)}>New list</Button>
      </div>

      {lists.error && <p className="text-body text-danger">{(lists.error as Error).message}</p>}
      {lists.data?.length === 0 && (
        <EmptyState icon={<ListVideo />} title="No lists yet" description="Make one here, from a title's “Add to list”, or save a film's franchise from its page." bordered />
      )}

      {current && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-meta text-fg-muted">
              {current.description || 'Private list on Trakt'} · {current.itemCount} title{current.itemCount === 1 ? '' : 's'}
            </p>
            <Button size="sm" variant="ghost" icon={<Trash2 />} className="text-danger" onClick={() => { void deleteList() }}>Delete list</Button>
          </div>
          {items.isLoading ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] gap-2.5">
              {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} rounded="rounded-md" className="aspect-[2/3] w-full" />)}
            </div>
          ) : (items.data ?? []).length === 0 ? (
            <p className="text-body text-fg-muted">Empty — add titles from their page with “Add to list”.</p>
          ) : (
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] gap-2.5">
              {(items.data ?? []).map(i => (
                <ListTile
                  key={i.listItemId}
                  item={i}
                  onOpen={() => i.tmdb && onOpenDetail(i.tmdb, i.type === 'show' ? 'tv' : 'movie')}
                  onRemove={() => i.tmdb && change.mutate({ listId: current.id, items: [{ type: i.type, tmdb: i.tmdb }], remove: true })}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}
