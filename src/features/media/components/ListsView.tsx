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
import { SmartListDialog } from './SmartListDialog'
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
 * Lists: your Trakt lists and smart lists (a franchise, studio, keyword or
 * person that collects its own films from TMDB) in a rail; the picked one on
 * the right with watched / not watched filters and every cover's status.
 */
export function ListsView({ onOpenDetail }: { onOpenDetail: (id: number, type: MediaType) => void }) {
  const { data: trakt, isLoading: statusLoading } = useTraktStatus()
  const lists = useTraktLists()
  const { data: follows = [], isLoading: followsLoading } = useFollows()
  const [picked, setPicked] = useState<Pick | null>(null)
  const [naming, setNaming] = useState(false)
  const [smartOpen, setSmartOpen] = useState(false)
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
    const ok = await modal.confirm({ title: `Remove the smart list “${smartCurrent.name}”?`, message: 'It stops collecting, and its What’s new events go too. Nothing in your library changes.', confirmLabel: 'Remove', destructive: true })
    if (ok) { unfollow.mutate({ followId: smartCurrent.id, kind: smartCurrent.kind, tmdbId: smartCurrent.tmdb_id, name: smartCurrent.name }); setPicked(null) }
  }

  return (
    <section className="@container flex flex-col gap-4">
      {naming && <NewListDialog onClose={() => setNaming(false)} />}
      {smartOpen && (
        <SmartListDialog
          onClose={() => setSmartOpen(false)}
          onCreated={() => setPicked(null)}
        />
      )}
      <div className="grid grid-cols-1 items-start gap-4 @[56rem]:grid-cols-[17rem_minmax(0,1fr)]">
        {/* Phones and narrow pages: one picker instead of the whole rail above the covers. */}
        <div className="card flex flex-wrap items-center gap-2 p-3 @[56rem]:hidden">
          <select aria-label="List" className="input min-w-0 flex-1"
            value={current ? `${current.src}:${current.id}` : ''}
            onChange={e => { const [src, id] = e.target.value.split(/:(.*)/s); setPicked(src === 'trakt' ? { src: 'trakt', id: Number(id) } : { src: 'smart', id }) }}>
            {traktLists.length > 0 && <optgroup label="My lists">{traktLists.map(l => <option key={l.id} value={`trakt:${l.id}`}>{l.name} ({l.itemCount})</option>)}</optgroup>}
            {follows.length > 0 && <optgroup label="Smart lists">{follows.map(f => <option key={f.id} value={`smart:${f.id}`}>{f.name} · {KIND_LABEL[f.kind]}</option>)}</optgroup>}
          </select>
          {trakt?.connected && <Button size="sm" variant="ghost" icon={<ListPlus />} onClick={() => setNaming(true)}>List</Button>}
          <Button size="sm" variant="ghost" icon={<Sparkles />} onClick={() => setSmartOpen(true)}>Smart list</Button>
          {!trakt?.connected && !statusLoading && <p className="w-full text-meta text-fg-muted">Your own lists live on Trakt. <Link to="/settings?tab=subscriptions" className="font-semibold text-accent-600">Connect Trakt</Link></p>}
        </div>
        <aside className="card hidden flex-col gap-3 p-3 @[56rem]:sticky @[56rem]:top-2 @[56rem]:flex">
          <div>
            <div className="mb-1 flex items-center justify-between gap-2 px-1">
              <span className="section-label">My lists</span>
              {trakt?.connected && <Button size="sm" variant="ghost" icon={<ListPlus />} onClick={() => setNaming(true)}>New</Button>}
            </div>
            {statusLoading || (trakt?.connected && lists.isLoading) ? <Skeleton className="h-10 w-full" />
              : !trakt?.connected ? (
                <p className="px-1 text-meta text-fg-muted">Lists live on Trakt. <Link to="/settings?tab=subscriptions" className="font-semibold text-accent-600">Connect Trakt</Link></p>
              ) : traktLists.length === 0 ? (
                <p className="px-1 text-meta text-fg-muted">No lists yet — make one, or use “Add to list” on a title.</p>
              ) : traktLists.map(l => (
                <RailButton key={l.id} active={current?.src === 'trakt' && current.id === l.id} label={l.name} meta={String(l.itemCount)} onClick={() => setPicked({ src: 'trakt', id: l.id })} />
              ))}
            {lists.error && <p className="px-1 text-meta text-danger">{(lists.error as Error).message}</p>}
          </div>
          <div className="border-t border-line pt-3">
            <div className="mb-1 flex items-center justify-between gap-2 px-1">
              <span className="section-label">Smart lists</span>
              <Button size="sm" variant="ghost" icon={<Sparkles />} onClick={() => setSmartOpen(true)}>New</Button>
            </div>
            {followsLoading ? <Skeleton className="h-10 w-full" />
              : follows.length === 0 ? (
                <p className="px-1 text-meta text-fg-muted">A smart list collects itself — e.g. every Marvel Studios film, watched and not.</p>
              ) : follows.map(f => (
                <RailButton key={f.id} active={current?.src === 'smart' && current.id === f.id} label={f.name} meta={KIND_LABEL[f.kind]} onClick={() => setPicked({ src: 'smart', id: f.id })} />
              ))}
          </div>
        </aside>

        <div className="card flex min-w-0 flex-col gap-3 p-4 sm:p-5">
          {!current ? (
            <EmptyState icon={<ListVideo />} title="No lists yet"
              description="Make a smart list from a franchise, studio, keyword or person — every film comes with it."
              action={<Button variant="primary" icon={<Sparkles />} onClick={() => setSmartOpen(true)}>New smart list</Button>} />
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
                  <p className="text-meta text-fg-muted">Smart list · {KIND_LABEL[smartCurrent.kind]} on TMDB · new titles and trailers show under What’s new</p>
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
                  <Button size="sm" variant="ghost" icon={<Trash2 />} className="text-danger" onClick={() => { void deleteSmart() }}>Remove</Button>
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
