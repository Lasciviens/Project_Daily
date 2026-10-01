import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ListPlus, ListVideo, Sparkles, Trash2 } from 'lucide-react'
import { useEntityModal } from '../../../shared/modals'
import { Button, EmptyState, Skeleton, Truncate } from '../../../shared/ui'
import { useFollows, useLinkFollowList, useToggleFollow } from '../hooks/useFollows'
import { useTraktStatus } from '../trakt/useTrakt'
import { useDeleteTraktList, useTraktLists } from '../trakt/useTraktExtras'
import type { FollowKind } from '../api/followsApi'
import type { MediaType } from '../types'
import { NewListDialog } from './NewListDialog'
import { FollowingPanel } from './FollowingPanel'
import { SmartListPanel, TraktListPanel } from './ListPanels'

const KIND_LABEL: Record<FollowKind, string> = { collection: 'Franchise', company: 'Studio', keyword: 'Keyword', director: 'Director', actor: 'Actor' }

type Pick = { src: 'trakt'; id: number } | { src: 'smart'; id: string }

function RailButton({ active, label, meta, onClick }: { active: boolean; label: string; meta: string; onClick: () => void }) {
  return (
    <button type="button" aria-current={active || undefined} onClick={onClick}
      className={`flex min-h-[44px] w-full items-center gap-2 rounded-row px-2.5 text-left transition-colors ${active ? 'bg-accent-50 text-accent-700' : 'hover:bg-surface-hover'}`}>
      <Truncate className="min-w-0 flex-1 text-body font-medium">{label}</Truncate>
      <span className="shrink-0 text-micro text-fg-muted tabular-nums">{meta}</span>
    </button>
  )
}

/**
 * Lists — one kind of thing: a list you fill yourself (Trakt) or one that fills
 * itself from a franchise, studio, keyword or person on TMDB (✦). They share a
 * rail and the same view on the right with watched / not watched filters and
 * every cover's status.
 */
export function ListsView({ onOpenDetail }: { onOpenDetail: (id: number, type: MediaType) => void }) {
  const { data: trakt, isLoading: statusLoading } = useTraktStatus()
  const lists = useTraktLists()
  const { data: follows = [], isLoading: followsLoading } = useFollows()
  const [picked, setPicked] = useState<Pick | null>(null)
  const [naming, setNaming] = useState(false)
  const del = useDeleteTraktList()
  const unfollow = useToggleFollow()
  const link = useLinkFollowList()
  const modal = useEntityModal()

  const traktLists = trakt?.connected ? lists.data ?? [] : []
  const current: Pick | null = picked
    ?? (traktLists[0] ? { src: 'trakt', id: traktLists[0].id } : follows[0] ? { src: 'smart', id: follows[0].id } : null)
  const traktCurrent = current?.src === 'trakt' ? traktLists.find(l => l.id === current.id) ?? null : null
  const smartCurrent = current?.src === 'smart' ? follows.find(f => f.id === current.id) ?? null : null

  async function deleteTrakt() {
    if (!traktCurrent) return
    const ok = await modal.confirm({ title: `Delete “${traktCurrent.name}”?`, message: 'The list is deleted on Trakt too. The titles stay in your library.', confirmLabel: 'Delete list', destructive: true })
    if (ok) { del.mutate(traktCurrent.id); setPicked(null) }
  }
  async function deleteSmart() {
    if (!smartCurrent) return
    const ok = await modal.confirm({ title: `Delete “${smartCurrent.name}”?`, message: 'It stops filling itself, and its What’s new events go too. Nothing in your library changes.', confirmLabel: 'Delete list', destructive: true })
    if (ok) { unfollow.mutate({ followId: smartCurrent.id, kind: smartCurrent.kind, tmdbId: smartCurrent.tmdb_id, name: smartCurrent.name }); setPicked(null) }
  }

  return (
    <section className="@container flex flex-col gap-4">
      {naming && <NewListDialog auto traktConnected={!!trakt?.connected} onClose={() => setNaming(false)} onAutoCreated={() => setPicked(null)} />}
      <div className="grid grid-cols-1 items-start gap-4 @[56rem]:grid-cols-[17rem_minmax(0,1fr)]">
        {/* Phones and narrow pages: one picker instead of the whole rail above the covers. */}
        <div className="card flex flex-wrap items-center gap-2 p-3 @[56rem]:hidden">
          <select aria-label="List" className="input min-w-0 flex-1"
            value={current ? `${current.src}:${current.id}` : ''}
            onChange={e => { const [src, id] = e.target.value.split(/:(.*)/s); setPicked(src === 'trakt' ? { src: 'trakt', id: Number(id) } : { src: 'smart', id }) }}>
            {traktLists.map(l => <option key={l.id} value={`trakt:${l.id}`}>{l.name} ({l.itemCount})</option>)}
            {follows.map(f => <option key={f.id} value={`smart:${f.id}`}>✦ {f.name} · {KIND_LABEL[f.kind]}</option>)}
          </select>
          <Button size="sm" variant="ghost" icon={<ListPlus />} onClick={() => setNaming(true)}>New list</Button>
          {!trakt?.connected && !statusLoading && <p className="w-full text-meta text-fg-muted">Lists you fill yourself live on Trakt. <Link to="/settings?tab=subscriptions" className="font-semibold text-accent-600">Connect Trakt</Link></p>}
        </div>
        <aside className="card hidden flex-col gap-1 p-3 @[56rem]:sticky @[56rem]:top-2 @[56rem]:flex">
          <div className="mb-1 flex items-center justify-between gap-2 px-1">
            <span className="section-label">Lists</span>
            <Button size="sm" variant="ghost" icon={<ListPlus />} onClick={() => setNaming(true)}>New</Button>
          </div>
          {statusLoading || followsLoading || (trakt?.connected && lists.isLoading) ? <Skeleton className="h-10 w-full" />
            : traktLists.length === 0 && follows.length === 0 ? (
              <p className="px-1 text-meta text-fg-muted">No lists yet — make one, or use “Add to list” on a title.</p>
            ) : <>
              {traktLists.map(l => (
                <RailButton key={l.id} active={current?.src === 'trakt' && current.id === l.id} label={l.name} meta={String(l.itemCount)} onClick={() => setPicked({ src: 'trakt', id: l.id })} />
              ))}
              {follows.map(f => (
                <RailButton key={f.id} active={current?.src === 'smart' && current.id === f.id} label={`✦ ${f.name}`} meta={KIND_LABEL[f.kind]} onClick={() => setPicked({ src: 'smart', id: f.id })} />
              ))}
            </>}
          {lists.error && <p className="px-1 text-meta text-danger">{(lists.error as Error).message}</p>}
          {!trakt?.connected && !statusLoading && (
            <p className="px-1 pt-2 text-meta text-fg-muted">Lists you fill yourself live on Trakt. <Link to="/settings?tab=subscriptions" className="font-semibold text-accent-600">Connect Trakt</Link></p>
          )}
          <p className="px-1 pt-2 text-micro text-fg-muted">✦ fills itself from a franchise, studio, keyword or person.</p>
        </aside>

        <div className="card flex min-w-0 flex-col gap-3 p-4 sm:p-5">
          {!current ? (
            <EmptyState icon={<ListVideo />} title="No lists yet"
              description="Add titles yourself, or let a list fill itself from a franchise, studio, keyword or person."
              action={<Button variant="primary" icon={<ListPlus />} onClick={() => setNaming(true)}>New list</Button>} />
          ) : traktCurrent ? (
            <>
              <header className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="text-lead font-semibold text-fg">{traktCurrent.name}</h2>
                  <p className="text-meta text-fg-muted">{traktCurrent.description || 'Private list on Trakt'} · {traktCurrent.itemCount} title{traktCurrent.itemCount === 1 ? '' : 's'}</p>
                </div>
                <Button size="sm" variant="ghost" icon={<Trash2 />} className="text-danger" onClick={() => { void deleteTrakt() }}>Delete list</Button>
              </header>
              <TraktListPanel key={traktCurrent.id} listId={traktCurrent.id} onOpen={onOpenDetail} />
            </>
          ) : smartCurrent ? (
            <>
              <header className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="flex items-center gap-1.5 text-lead font-semibold text-fg"><Sparkles aria-hidden className="h-4 w-4 text-fg-muted" />{smartCurrent.name}</h2>
                  <p className="text-meta text-fg-muted">Fills itself · {KIND_LABEL[smartCurrent.kind]} on TMDB · new titles and trailers show under What’s new</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {trakt?.connected && traktLists.length > 0 && (
                    <select aria-label="Also add new titles to a Trakt list" className="input min-h-[44px] w-auto max-w-[14rem] py-0 text-meta sm:min-h-[36px]"
                      value={smartCurrent.trakt_list_id ?? ''}
                      onChange={e => link.mutate({ id: smartCurrent.id, listId: e.target.value ? Number(e.target.value) : null })}>
                      <option value="">New titles: no Trakt list</option>
                      {traktLists.map(l => <option key={l.id} value={l.id}>New titles → “{l.name}”</option>)}
                    </select>
                  )}
                  <Button size="sm" variant="ghost" icon={<Trash2 />} className="text-danger" onClick={() => { void deleteSmart() }}>Delete list</Button>
                </div>
              </header>
              <SmartListPanel key={smartCurrent.id} follow={smartCurrent} onOpen={onOpenDetail} />
            </>
          ) : <Skeleton className="h-40 w-full" />}
        </div>
      </div>
      <FollowingPanel />
    </section>
  )
}
