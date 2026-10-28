import { Link } from 'react-router-dom'
import { CloudUpload, Sparkles, Trash2, Unlink } from 'lucide-react'
import { confirmDelete } from '../../../shared/modals'
import { Button } from '../../../shared/ui'
import { FOLLOW_KIND_LABEL as KIND_LABEL, type MediaFollow } from '../api/followsApi'
import { useDeleteFollow } from '../hooks/useFollows'
import { useCreateAutoList, useDeleteAutoList, useStopAutoFill } from '../hooks/useAutoLists'
import { useDeleteTraktList } from '../trakt/useTraktExtras'
import type { TraktList } from '../trakt/traktApi'
import type { OpenMediaDetail } from '../types'
import { SmartListPanel, TraktListPanel } from './ListPanels'
import { QueuePanel } from './QueuePanel'
import { FollowListNotice } from './FollowListNotice'

type Open = OpenMediaDetail

/** A Trakt list — filled by you, or (✦) filled from TMDB by its rule. */
export function TraktListDetail({ list, follow, onOpen, onGone, isQueue = false }: { list: TraktList; follow: MediaFollow | null; onOpen: Open; onGone: () => void; isQueue?: boolean }) {
  const delList = useDeleteTraktList()
  const delAuto = useDeleteAutoList()
  const stop = useStopAutoFill()

  // Deleted on Trakt: no Undo (a new list would get a new id and lose its
  // order), and the question says so.
  async function remove() {
    const result = await confirmDelete({
      title: `Delete “${list.name}”?`,
      message: follow ? 'The list is deleted on Trakt and stops filling itself. The titles stay in your library.' : 'The list is deleted on Trakt too. The titles stay in your library.',
      confirmLabel: 'Delete list',
      remove: () => (follow ? delAuto.mutateAsync({ follow, listId: list.id }) : delList.mutateAsync(list.id)),
      done: 'List deleted',
    })
    if (result === 'deleted' || result === 'gone') onGone()
  }

  return (
    <>
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5 text-lead font-semibold text-fg">
            {follow && <Sparkles aria-hidden className="h-4 w-4 text-fg-muted" />}{list.name}
          </h2>
          <p className="text-meta text-fg-muted">
            {isQueue ? 'What to watch next, in your order — a private list on Trakt' : follow ? `On Trakt · fills itself from the ${KIND_LABEL[follow.kind].toLowerCase()} on TMDB` : list.description || 'Private list on Trakt'}
            {' · '}{list.itemCount} title{list.itemCount === 1 ? '' : 's'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {follow && (
            <Button size="sm" variant="ghost" icon={<Unlink />} title="Keep the list on Trakt but stop adding new films"
              loading={stop.busy} onClick={() => { void stop.run(follow) }}>Stop filling</Button>
          )}
          <Button size="sm" variant="ghost" icon={<Trash2 />} className="text-danger" onClick={() => { void remove() }}>Delete list</Button>
        </div>
      </header>
      {follow && <FollowListNotice follow={follow} />}
      {isQueue ? <QueuePanel onOpen={onOpen} /> : <TraktListPanel key={list.id} listId={list.id} onOpen={onOpen} />}
    </>
  )
}

/** A rule whose list is not on Trakt yet (made before this rule, or without Trakt). */
export function PendingListDetail({ follow, connected, onOpen, onGone }: { follow: MediaFollow; connected: boolean; onOpen: Open; onGone: () => void }) {
  const put = useCreateAutoList()
  const drop = useDeleteFollow()

  async function remove() {
    const result = await drop.run([follow.id], {
      title: `Delete “${follow.name}”?`,
      message: 'It is only in this app, so nothing changes on Trakt or in your library.',
      confirmLabel: 'Delete list',
      done: 'List deleted',
    })
    if (result === 'deleted' || result === 'gone') onGone()
  }

  return (
    <>
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5 text-lead font-semibold text-fg"><Sparkles aria-hidden className="h-4 w-4 text-fg-muted" />{follow.name}</h2>
          <p data-tone="warn" className="tone-text text-meta">Only in this app — not on Trakt yet. {KIND_LABEL[follow.kind]} on TMDB.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {connected
            ? <Button size="sm" variant="primary" icon={<CloudUpload />} loading={put.isPending}
                onClick={() => put.mutate({ kind: follow.kind, tmdbId: follow.tmdb_id, name: follow.name, follow })}>Put on Trakt</Button>
            : <Link to="/settings?tab=subscriptions" className="btn-ghost btn-sm">Connect Trakt</Link>}
          <Button size="sm" variant="ghost" icon={<Trash2 />} className="text-danger" onClick={() => { void remove() }}>Delete list</Button>
        </div>
      </header>
      <SmartListPanel key={follow.id} follow={follow} onOpen={onOpen} />
    </>
  )
}
