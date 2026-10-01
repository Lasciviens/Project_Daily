import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CloudUpload, ListPlus, ListVideo } from 'lucide-react'
import { Button, EmptyState, Skeleton, Truncate } from '../../../shared/ui'
import { useFollows } from '../hooks/useFollows'
import { useCreateAutoList } from '../hooks/useAutoLists'
import { useTraktStatus } from '../trakt/useTrakt'
import { useTraktLists } from '../trakt/useTraktExtras'
import type { MediaType } from '../types'
import { NewListDialog } from './NewListDialog'
import { FollowingPanel } from './FollowingPanel'
import { PendingListDetail, TraktListDetail } from './ListDetail'
import { FOLLOW_KIND_LABEL as KIND_LABEL } from '../api/followsApi'

type Pick = { src: 'trakt'; id: number } | { src: 'pending'; id: string }

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
 * Lists — every list is a Trakt list, so Trakt shows exactly what this page
 * shows. A ✦ list also fills itself from a franchise, studio, keyword or
 * person on TMDB (its rule lives in media_follows, linked by trakt_list_id).
 * A rule with no list on Trakt yet (older ones, or made without Trakt) is
 * listed as "not on Trakt yet" with Put on Trakt.
 */
export function ListsView({ onOpenDetail }: { onOpenDetail: (id: number, type: MediaType) => void }) {
  const { data: trakt, isLoading: statusLoading } = useTraktStatus()
  const connected = !!trakt?.connected
  const lists = useTraktLists()
  const { data: follows = [], isLoading: followsLoading } = useFollows()
  const [picked, setPicked] = useState<Pick | null>(null)
  const [naming, setNaming] = useState(false)
  const putAll = useCreateAutoList()
  const [putting, setPutting] = useState(false)

  const traktLists = connected ? lists.data ?? [] : []
  const listsKnown = !connected || lists.isSuccess
  const ruleFor = (listId: number) => follows.find(f => f.trakt_list_id === listId) ?? null
  // Not on Trakt: no list yet, or its list was deleted on Trakt.
  const pending = listsKnown ? follows.filter(f => !f.trakt_list_id || !traktLists.some(l => l.id === f.trakt_list_id)) : []

  const current: Pick | null = picked
    ?? (traktLists[0] ? { src: 'trakt', id: traktLists[0].id } : pending[0] ? { src: 'pending', id: pending[0].id } : null)
  const traktCurrent = current?.src === 'trakt' ? traktLists.find(l => l.id === current.id) ?? null : null
  const pendingCurrent = current?.src === 'pending' ? pending.find(f => f.id === current.id) ?? null : null
  const loading = statusLoading || followsLoading || (connected && lists.isLoading)

  async function putAllOnTrakt() {
    setPutting(true)
    try {
      for (const f of pending) await putAll.mutateAsync({ kind: f.kind, tmdbId: f.tmdb_id, name: f.name, follow: f })
    } catch { /* toasted; the rest stay pending */ } finally { setPutting(false) }
  }

  const railLabel = (name: string, auto: boolean) => (auto ? `✦ ${name}` : name)

  return (
    <section className="@container flex flex-col gap-4">
      {naming && <NewListDialog auto traktConnected={connected} onClose={() => setNaming(false)} onAutoCreated={() => setPicked(null)} />}
      {connected && pending.length > 0 && (
        <div data-tone="warn" className="tone-soft flex w-fit max-w-full flex-wrap items-center gap-3 rounded-row px-3 py-2 text-body">
          <span>{pending.length} list{pending.length === 1 ? ' is' : 's are'} only in this app, so Trakt can't see {pending.length === 1 ? 'it' : 'them'}.</span>
          <Button size="sm" variant="primary" icon={<CloudUpload />} loading={putting} onClick={() => { void putAllOnTrakt() }}>Put {pending.length === 1 ? 'it' : 'all'} on Trakt</Button>
        </div>
      )}
      <div className="grid grid-cols-1 items-start gap-4 @[56rem]:grid-cols-[17rem_minmax(0,1fr)]">
        {/* Phones and narrow pages: one picker instead of the whole rail above the covers. */}
        <div className="card flex flex-wrap items-center gap-2 p-3 @[56rem]:hidden">
          <select aria-label="List" className="input min-w-0 flex-1"
            value={current ? `${current.src}:${current.id}` : ''}
            onChange={e => { const [src, id] = e.target.value.split(/:(.*)/s); setPicked(src === 'trakt' ? { src: 'trakt', id: Number(id) } : { src: 'pending', id }) }}>
            {traktLists.map(l => <option key={l.id} value={`trakt:${l.id}`}>{railLabel(l.name, !!ruleFor(l.id))} ({l.itemCount})</option>)}
            {pending.map(f => <option key={f.id} value={`pending:${f.id}`}>✦ {f.name} · not on Trakt yet</option>)}
          </select>
          <Button size="sm" variant="ghost" icon={<ListPlus />} onClick={() => setNaming(true)}>New list</Button>
          {!connected && !statusLoading && <p className="w-full text-meta text-fg-muted">Lists live on Trakt. <Link to="/settings?tab=subscriptions" className="font-semibold text-accent-600">Connect Trakt</Link></p>}
        </div>
        <aside className="card hidden flex-col gap-1 p-3 @[56rem]:sticky @[56rem]:top-2 @[56rem]:flex">
          <div className="mb-1 flex items-center justify-between gap-2 px-1">
            <span className="section-label">Lists on Trakt</span>
            <Button size="sm" variant="ghost" icon={<ListPlus />} onClick={() => setNaming(true)}>New</Button>
          </div>
          {loading ? <Skeleton className="h-10 w-full" />
            : traktLists.length === 0 && pending.length === 0 ? (
              <p className="px-1 text-meta text-fg-muted">No lists yet — make one, or use “Add to list” on a title.</p>
            ) : traktLists.map(l => {
              const rule = ruleFor(l.id)
              return <RailButton key={l.id} active={current?.src === 'trakt' && current.id === l.id} label={railLabel(l.name, !!rule)} meta={String(l.itemCount)} onClick={() => setPicked({ src: 'trakt', id: l.id })} />
            })}
          {pending.length > 0 && (
            <div className="mt-2 border-t border-line pt-2">
              <span className="section-label px-1">Not on Trakt yet</span>
              {pending.map(f => (
                <RailButton key={f.id} active={current?.src === 'pending' && current.id === f.id} label={`✦ ${f.name}`} meta={KIND_LABEL[f.kind]} onClick={() => setPicked({ src: 'pending', id: f.id })} />
              ))}
            </div>
          )}
          {lists.error && <p className="px-1 text-meta text-danger">{(lists.error as Error).message}</p>}
          {!connected && !statusLoading && (
            <p className="px-1 pt-2 text-meta text-fg-muted">Lists live on Trakt. <Link to="/settings?tab=subscriptions" className="font-semibold text-accent-600">Connect Trakt</Link></p>
          )}
          <p className="px-1 pt-2 text-micro text-fg-muted">✦ also fills itself from a franchise, studio, keyword or person.</p>
        </aside>

        <div className="card flex min-w-0 flex-col gap-3 p-4 sm:p-5">
          {!current ? (
            loading ? <Skeleton className="h-40 w-full" /> : (
              <EmptyState icon={<ListVideo />} title="No lists yet"
                description="Add titles yourself, or let a list fill itself from a franchise, studio, keyword or person."
                action={<Button variant="primary" icon={<ListPlus />} onClick={() => setNaming(true)}>New list</Button>} />
            )
          ) : traktCurrent ? (
            <TraktListDetail key={traktCurrent.id} list={traktCurrent} follow={ruleFor(traktCurrent.id)} onOpen={onOpenDetail} onGone={() => setPicked(null)} />
          ) : pendingCurrent ? (
            <PendingListDetail key={pendingCurrent.id} follow={pendingCurrent} connected={connected} onOpen={onOpenDetail} onGone={() => setPicked(null)} />
          ) : <Skeleton className="h-40 w-full" />}
        </div>
      </div>
      <FollowingPanel />
    </section>
  )
}
