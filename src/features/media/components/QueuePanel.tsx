import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'
import { ArrowDown, ArrowUp, CalendarPlus, ChevronsUp, MoreHorizontal, X } from 'lucide-react'
import { posterUrl } from '../../../integrations/tmdb/client'
import { useEntityModal } from '../../../shared/modals'
import { IconButton, Skeleton, ToneDot, Truncate } from '../../../shared/ui'
import { useLibraryIndex } from '../hooks/useLibraryIndex'
import { BUCKET_LABEL, BUCKET_TONE } from '../libraryModel'
import { libraryKey } from '../listModel'
import { moveItem } from '../queue/queueModel'
import { useQueue, useReorderQueue } from '../queue/useQueue'
import { useRemoveFromTraktList } from '../trakt/useTraktExtras'
import type { TraktListItem } from '../trakt/traktApi'
import type { MediaType, OpenMediaDetail } from '../types'

/**
 * The Queue in order: move titles up and down (the order is saved on Trakt),
 * plan one, take finished ones out. Watched titles say so.
 */
export function QueuePanel({ onOpen }: { onOpen: OpenMediaDetail }) {
  const { list, items, loading } = useQueue()
  const reorder = useReorderQueue(list?.id ?? null)
  const removeItems = useRemoveFromTraktList()
  const index = useLibraryIndex()
  const modal = useEntityModal()

  if (loading) return <Skeleton className="h-40 w-full" />
  if (!list || items.length === 0) {
    return <p className="text-body text-fg-muted">The Queue is empty — use “+ Queue” on a title page. New titles go to the end; move them here.</p>
  }
  const typeOf = (i: TraktListItem): MediaType => (i.type === 'show' ? 'tv' : 'movie')
  const libOf = (i: TraktListItem) => (i.tmdb ? index.get(libraryKey(typeOf(i), i.tmdb)) : undefined)
  const move = (from: number, to: number) => { if (from !== to) reorder.mutate(moveItem(items, from, to)) }
  const remove = (items: TraktListItem[], title: string, done: string) => {
    const refs = items.filter(i => i.tmdb).map(i => ({ type: i.type, tmdb: i.tmdb! }))
    void removeItems(list.id, refs, { title, done })
  }
  const finished = items.filter(i => libOf(i)?.bucket === 'completed')
  const removeOne = (i: TraktListItem) => remove([i], `Take “${i.title}” out of the Queue?`, `Took “${i.title}” out of the Queue`)
  const plan = (i: TraktListItem) => modal.open({
    kind: 'time-block',
    defaults: { title: `Watch: ${i.title}`, duration: i.type === 'show' ? 60 : 120, category: 'media', color: 'purple', alsoCreateTask: true },
  })

  return (
    <div className="@container flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-meta text-fg-muted">
        {/* The count is in the list's header line already. */}
        <span>The order is saved on Trakt</span>
        {finished.length > 0 && (
          <button type="button" className="min-h-[44px] font-semibold text-accent-600" onClick={() => remove(finished, `Take ${finished.length} watched out of the Queue?`, `Took ${finished.length} watched out of the Queue`)}>
            Remove {finished.length} watched
          </button>
        )}
      </div>
      <ol className="flex max-w-3xl flex-col gap-2">
        {items.map((i, n) => {
          const lib = libOf(i)
          return (
            <li key={i.listItemId} className="flex items-center gap-2 rounded-row border border-line bg-surface p-2">
              <span className="w-6 shrink-0 text-center text-meta font-semibold text-fg-muted tabular-nums">{n + 1}</span>
              <button type="button" disabled={!i.tmdb} onClick={() => i.tmdb && onOpen(i.tmdb, typeOf(i), items.filter(x => x.tmdb).map(x => ({ tmdbId: x.tmdb!, mediaType: typeOf(x) })))} className="press-feedback flex min-w-0 flex-1 items-center gap-3 text-left">
                <span className="h-[54px] w-9 shrink-0 overflow-hidden rounded bg-surface-2">
                  {(i.posterPath ?? lib?.posterPath) && <img src={posterUrl(i.posterPath ?? lib?.posterPath ?? null, 'w92')} alt="" loading="lazy" className="h-full w-full object-cover" />}
                </span>
                <span className="min-w-0">
                  <Truncate className="text-body font-medium text-fg">{i.title}</Truncate>
                  <span className="flex items-center gap-1.5 text-micro text-fg-muted">
                    {[i.type === 'show' ? 'TV' : 'Movie', i.year].filter(Boolean).join(' · ')}
                    {lib && <><ToneDot tone={BUCKET_TONE[lib.bucket]} /> {BUCKET_LABEL[lib.bucket]}</>}
                  </span>
                </span>
              </button>
              {/* Narrow (a phone): up, down and ⋯ — the title keeps its room; wide: every action in the row. */}
              <div className="flex shrink-0 items-center">
                {n > 1 && <IconButton label="Move to the top" onClick={() => move(n, 0)} className="hidden @[34rem]:inline-flex"><ChevronsUp /></IconButton>}
                <IconButton label="Move up" disabled={n === 0 || reorder.isPending} onClick={() => move(n, n - 1)}><ArrowUp /></IconButton>
                <IconButton label="Move down" disabled={n === items.length - 1 || reorder.isPending} onClick={() => move(n, n + 1)}><ArrowDown /></IconButton>
                <IconButton label={`Plan ${i.title}`} onClick={() => plan(i)} className="hidden @[34rem]:inline-flex"><CalendarPlus /></IconButton>
                <IconButton label={`Remove ${i.title} from the Queue`} onClick={() => removeOne(i)} className="hidden @[34rem]:inline-flex"><X /></IconButton>
                <Menu as="div" className="@[34rem]:hidden">
                  <MenuButton className="icon-btn" aria-label={`More for ${i.title}`} title={`More for ${i.title}`}>
                    <MoreHorizontal className="h-4 w-4" aria-hidden />
                  </MenuButton>
                  <MenuItems anchor="bottom end" transition className="menu w-48 [--anchor-gap:4px] transition duration-150 data-[closed]:opacity-0">
                    {n > 0 && (
                      <MenuItem>
                        <button type="button" title="Top — move it to the top of the Queue" className="menu-item" onClick={() => move(n, 0)}><ChevronsUp aria-hidden className="h-4 w-4" /> Top</button>
                      </MenuItem>
                    )}
                    <MenuItem>
                      <button type="button" title={`Plan — put “${i.title}” in your calendar`} className="menu-item" onClick={() => plan(i)}><CalendarPlus aria-hidden className="h-4 w-4" /> Plan</button>
                    </MenuItem>
                    <MenuItem>
                      <button type="button" title={`Remove — take “${i.title}” out of the Queue`} className="menu-item" onClick={() => removeOne(i)}><X aria-hidden className="h-4 w-4" /> Remove</button>
                    </MenuItem>
                  </MenuItems>
                </Menu>
              </div>
            </li>
          )
        })}
      </ol>
      <p className="text-micro text-fg-faint">Tip: the same list is “Queue” on Trakt — reordering there shows up here too.</p>
      {reorder.isPending && <span className="sr-only" aria-live="polite">Saving the order…</span>}
    </div>
  )
}
