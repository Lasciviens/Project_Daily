import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Plus, ChevronRight, Trash2, ArrowUpDown, Zap } from 'lucide-react'
import { useUIStore } from '../../../app/store'
import {
  useDevRequests, useUpdateDevRequest, useDeleteDevRequest, useBulkDeleteDevRequests, useReorderDevRequests,
} from '../hooks/useDevRequests'
import { DEV_REQUEST_STATUS_CYCLE } from '../api/devRequestsApi'
import { DevRequestCard } from './DevRequestCard'
import { DevRequestForm } from './DevRequestForm'
import { SideDrawer } from '../../../shared/modals/SideDrawer'
import { useEntityModal } from '../../../shared/modals'
import { Button, Skeleton, cx } from '../../../shared/ui'
import type { DevRequest, DevRequestCategory, DevRequestPriority } from '../types'

const CATEGORIES: DevRequestCategory[] = ['bug', 'feature', 'improvement', 'integration', 'longterm', 'question', 'other']

type SortMode = 'manual' | 'priority'
const PRIORITY_RANK: Record<DevRequestPriority, number> = { urgent: 0, high: 1, medium: 2, low: 3 }

const CHIP = 'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-meta font-semibold tabular-nums transition-colors duration-100 [@media(pointer:coarse)]:h-11'
const CHIP_IDLE = 'border-line bg-surface-2 text-fg-2 [@media(hover:hover)]:hover:border-line-strong [@media(hover:hover)]:hover:text-fg'
const CHIP_ON = 'border-accent-500/30 bg-accent-50 text-accent-700'

/** The in-app backlog (dev_requests): jot bugs, features and ideas about the app itself. */
export function DevRequestsDrawer() {
  const isOpen = useUIStore(s => s.isDevRequestsOpen)
  const close = useUIStore(s => s.closeDevRequests)
  const location = useLocation()
  const modal = useEntityModal()
  const { data: requests = [], isLoading } = useDevRequests()
  const updateRequest = useUpdateDevRequest()
  const deleteRequest = useDeleteDevRequest()
  const bulkDelete = useBulkDeleteDevRequests()
  const reorder = useReorderDevRequests()

  const [showNewForm, setShowNewForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  // Multi-select: several categories can be checked at once; the visible set is their union.
  const [categoryFilters, setCategoryFilters] = useState<Set<DevRequestCategory>>(new Set())
  const [sortMode, setSortMode] = useState<SortMode>('manual')
  const [draggingId, setDraggingId] = useState<string | null>(null)
  // Completed items collapse out of the way by default — expand on demand.
  const [showDone, setShowDone] = useState(false)

  function toggleCategoryFilter(c: DevRequestCategory) {
    setCategoryFilters(prev => {
      const next = new Set(prev)
      if (next.has(c)) next.delete(c); else next.add(c)
      return next
    })
  }

  const active = requests.filter(r => r.status !== 'dismissed')
  const filtered = categoryFilters.size > 0 ? active.filter(r => categoryFilters.has(r.category)) : active
  const openItems = filtered.filter(r => r.status !== 'done')
  const doneItems = filtered.filter(r => r.status === 'done')
  const sorted = sortMode === 'priority'
    ? [...openItems].sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority])
    : openItems

  // "Closed" = done + dismissed — dismissed rows are hidden from the list but
  // have no other delete path, so the bulk action covers both.
  const closedIds = requests.filter(r => r.status === 'done' || r.status === 'dismissed').map(r => r.id)

  async function handleDeleteAllClosed() {
    if (closedIds.length === 0) return
    const ok = await modal.confirm({
      title: `Delete ${closedIds.length} closed request${closedIds.length === 1 ? '' : 's'}?`,
      message: "Every done and dismissed request is removed. This can't be undone.",
      confirmLabel: 'Delete',
      destructive: true,
    })
    if (ok) bulkDelete.mutate(closedIds)
  }

  async function handleDelete(request: DevRequest) {
    const ok = await modal.confirm({ title: `Delete "${request.title}"?`, confirmLabel: 'Delete', destructive: true })
    if (ok) deleteRequest.mutate(request.id)
  }

  function handleCycleStatus(request: DevRequest) {
    const idx = DEV_REQUEST_STATUS_CYCLE.indexOf(request.status as typeof DEV_REQUEST_STATUS_CYCLE[number])
    const next = DEV_REQUEST_STATUS_CYCLE[(idx + 1) % DEV_REQUEST_STATUS_CYCLE.length]
    updateRequest.mutate({ id: request.id, patch: { status: next } })
  }

  function handleDrop(targetId: string) {
    if (!draggingId || draggingId === targetId || sortMode !== 'manual') { setDraggingId(null); return }
    const ids = sorted.map(r => r.id)
    const from = ids.indexOf(draggingId)
    const to = ids.indexOf(targetId)
    ids.splice(to, 0, ids.splice(from, 1)[0])
    setDraggingId(null)
    reorder.mutate(ids)
  }

  const renderRow = (request: DevRequest, draggable: boolean) => editingId === request.id
    ? <DevRequestForm request={request} onDone={() => setEditingId(null)} />
    : (
      <DevRequestCard
        request={request}
        dragging={draggable && draggingId === request.id}
        onDragStart={() => { if (draggable) setDraggingId(request.id) }}
        onDragEnd={() => setDraggingId(null)}
        onCycleStatus={() => handleCycleStatus(request)}
        onDelete={() => void handleDelete(request)}
        onEdit={() => setEditingId(request.id)}
      />
    )

  const filters = (
    <div className="flex flex-col gap-1.5 px-4 pb-2.5 sm:px-5">
      <div className="scroll-x flex items-center gap-1.5 sm:flex-wrap">
        <button
          type="button"
          onClick={() => setCategoryFilters(new Set())}
          aria-pressed={categoryFilters.size === 0}
          className={cx(CHIP, categoryFilters.size === 0 ? CHIP_ON : CHIP_IDLE)}
        >
          All <span className="opacity-70">{active.length}</span>
        </button>
        {CATEGORIES.map(c => {
          const count = active.filter(r => r.category === c).length
          if (count === 0) return null
          const on = categoryFilters.has(c)
          return (
            <button key={c} type="button" onClick={() => toggleCategoryFilter(c)} aria-pressed={on} className={cx(CHIP, on ? CHIP_ON : CHIP_IDLE)}>
              {c} <span className="opacity-70">{count}</span>
            </button>
          )
        })}
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-meta text-fg-muted">
          {categoryFilters.size > 0 ? `${categoryFilters.size} categor${categoryFilters.size === 1 ? 'y' : 'ies'} selected` : 'All categories'}
        </span>
        <button
          type="button"
          onClick={() => setSortMode(m => (m === 'manual' ? 'priority' : 'manual'))}
          title="Toggle sort order"
          className={cx(CHIP, CHIP_IDLE)}
        >
          {sortMode === 'manual'
            ? <><ArrowUpDown className="h-3.5 w-3.5" aria-hidden />Manual order</>
            : <><Zap className="h-3.5 w-3.5" aria-hidden />By priority</>}
        </button>
      </div>
    </div>
  )

  return (
    <SideDrawer
      open={isOpen}
      onClose={close}
      title="Requests & ideas"
      headerActions={
        <Button variant="ghost" size="sm" icon={<Plus />} onClick={() => setShowNewForm(v => !v)} aria-expanded={showNewForm} className="text-accent-600">
          New
        </Button>
      }
      headerExtra={filters}
      widthClassName="w-[28rem]"
      phoneHeight="80dvh"
    >
      <div className="scroll-y min-h-0 flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
        {showNewForm && <DevRequestForm currentPage={location.pathname} onDone={() => setShowNewForm(false)} />}

        {/* Open items only; done items collapse into their own section below
            so a long finished history never pushes open ones out of view. */}
        <div className="flex flex-col gap-1.5 p-3 sm:px-4">
          {isLoading ? (
            [1, 2, 3].map(i => <Skeleton key={i} className="h-14 rounded-row" />)
          ) : sorted.length === 0 ? (
            <p className="py-8 text-center text-body text-fg-muted">
              {categoryFilters.size > 0 ? 'Nothing in these categories.' : 'Nothing yet — tap New to jot something down.'}
            </p>
          ) : (
            sorted.map(request => (
              <div key={request.id} onDragOver={e => sortMode === 'manual' && e.preventDefault()} onDrop={() => handleDrop(request.id)}>
                {renderRow(request, true)}
              </div>
            ))
          )}

          {doneItems.length > 0 && (
            <div className="mt-2 border-t border-line pt-2">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setShowDone(v => !v)}
                  aria-expanded={showDone}
                  className="flex min-h-[44px] flex-1 items-center gap-1.5 px-1.5 text-body font-semibold text-fg-muted hover:text-fg"
                >
                  <ChevronRight className={cx('h-4 w-4 transition-transform', showDone && 'rotate-90')} aria-hidden />
                  Completed ({doneItems.length})
                </button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Trash2 />}
                  onClick={() => void handleDeleteAllClosed()}
                  disabled={bulkDelete.isPending}
                  title="Delete every done + dismissed request"
                  className="text-fg-muted hover:!text-danger"
                >
                  Delete all closed
                </Button>
              </div>
              {showDone && (
                <div className="mt-1.5 flex flex-col gap-1.5">
                  {doneItems.map(request => <div key={request.id}>{renderRow(request, false)}</div>)}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </SideDrawer>
  )
}
