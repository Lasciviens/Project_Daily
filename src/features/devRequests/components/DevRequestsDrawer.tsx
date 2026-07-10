import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useUIStore } from '../../../app/store'
import {
  useDevRequests, useCreateDevRequest, useUpdateDevRequest, useDeleteDevRequest, useReorderDevRequests,
} from '../hooks/useDevRequests'
import { DEV_REQUEST_STATUS_CYCLE } from '../api/devRequestsApi'
import { DevRequestCard } from './DevRequestCard'
import { CATEGORY_BADGE } from './devRequestMeta'
import type { DevRequest, DevRequestCategory, DevRequestPriority, DevRequestEffort } from '../types'

const CATEGORIES: DevRequestCategory[] = ['bug', 'feature', 'improvement', 'integration', 'longterm', 'question', 'other']
const PRIORITIES: DevRequestPriority[] = ['low', 'medium', 'high', 'urgent']
const EFFORTS: DevRequestEffort[] = ['small', 'medium', 'large']

type SortMode = 'manual' | 'priority'
const PRIORITY_RANK: Record<DevRequestPriority, number> = { urgent: 0, high: 1, medium: 2, low: 3 }

function NewRequestForm({ currentPage, onDone }: { currentPage: string; onDone: () => void }) {
  const create = useCreateDevRequest()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [page, setPage] = useState(currentPage)
  const [category, setCategory] = useState<DevRequestCategory>('feature')
  const [priority, setPriority] = useState<DevRequestPriority>('medium')
  const [effort, setEffort] = useState<DevRequestEffort | ''>('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    create.mutate(
      { title: title.trim(), description: description.trim() || null, page, category, priority, effort: effort || null },
      { onSuccess: onDone },
    )
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2 p-3 bg-cream-50 border-b border-ink-100">
      <input
        autoFocus value={title} onChange={e => setTitle(e.target.value)}
        placeholder="What's the request/bug/idea?"
        className="min-h-[40px] px-2.5 text-sm border border-ink-200 rounded-lg bg-white"
      />
      <textarea
        value={description} onChange={e => setDescription(e.target.value)}
        placeholder="Details (optional) — the more context, the less back-and-forth later"
        rows={4}
        className="px-2.5 py-1.5 text-xs border border-ink-200 rounded-lg bg-white resize-y min-h-[90px] lg:min-h-[180px]"
      />
      <div className="grid grid-cols-2 gap-1.5">
        <select value={category} onChange={e => setCategory(e.target.value as DevRequestCategory)}
          className="min-h-[36px] px-2 text-xs border border-ink-200 rounded-lg bg-white">
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={priority} onChange={e => setPriority(e.target.value as DevRequestPriority)}
          className="min-h-[36px] px-2 text-xs border border-ink-200 rounded-lg bg-white">
          {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <input value={page} onChange={e => setPage(e.target.value)} placeholder="Page"
          className="min-h-[36px] px-2 text-xs border border-ink-200 rounded-lg bg-white" />
        <select value={effort} onChange={e => setEffort(e.target.value as DevRequestEffort | '')}
          className="min-h-[36px] px-2 text-xs border border-ink-200 rounded-lg bg-white">
          <option value="">effort?</option>
          {EFFORTS.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
      </div>
      <div className="flex gap-1.5">
        <button type="submit" disabled={create.isPending || !title.trim()}
          className="flex-1 min-h-[36px] rounded-lg text-xs font-semibold bg-accent-500 text-white hover:bg-accent-600 disabled:opacity-50">
          {create.isPending ? 'Saving…' : 'Add'}
        </button>
        <button type="button" onClick={onDone} className="min-h-[36px] px-3 rounded-lg text-xs text-ink-500 hover:text-ink-800">
          Cancel
        </button>
      </div>
    </form>
  )
}

function EditRequestForm({ request, onDone }: { request: DevRequest; onDone: () => void }) {
  const update = useUpdateDevRequest()
  const [title, setTitle] = useState(request.title)
  const [description, setDescription] = useState(request.description ?? '')
  const [page, setPage] = useState(request.page ?? '')
  const [category, setCategory] = useState(request.category)
  const [priority, setPriority] = useState(request.priority)
  const [effort, setEffort] = useState<DevRequestEffort | ''>(request.effort ?? '')

  function handleSave() {
    if (!title.trim()) return
    update.mutate(
      { id: request.id, patch: { title: title.trim(), description: description.trim() || null, page, category, priority, effort: effort || null } },
      { onSuccess: onDone },
    )
  }

  return (
    <div className="flex flex-col gap-2 p-2.5 bg-accent-50/60 border border-accent-200 rounded-xl">
      <input value={title} onChange={e => setTitle(e.target.value)}
        className="min-h-[36px] px-2 text-sm border border-ink-200 rounded-lg bg-white" />
      <textarea value={description} onChange={e => setDescription(e.target.value)} rows={4}
        placeholder="Details (optional)"
        className="px-2 py-1.5 text-xs border border-ink-200 rounded-lg bg-white resize-y min-h-[90px] lg:min-h-[180px]" />
      <div className="grid grid-cols-2 gap-1.5">
        <select value={category} onChange={e => setCategory(e.target.value as DevRequestCategory)}
          className="min-h-[32px] px-2 text-xs border border-ink-200 rounded-lg bg-white">
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={priority} onChange={e => setPriority(e.target.value as DevRequestPriority)}
          className="min-h-[32px] px-2 text-xs border border-ink-200 rounded-lg bg-white">
          {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <input value={page} onChange={e => setPage(e.target.value)} placeholder="Page"
          className="min-h-[32px] px-2 text-xs border border-ink-200 rounded-lg bg-white" />
        <select value={effort} onChange={e => setEffort(e.target.value as DevRequestEffort | '')}
          className="min-h-[32px] px-2 text-xs border border-ink-200 rounded-lg bg-white">
          <option value="">effort?</option>
          {EFFORTS.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
      </div>
      <div className="flex gap-1.5">
        <button type="button" onClick={handleSave} disabled={update.isPending}
          className="flex-1 min-h-[32px] rounded-lg text-xs font-semibold bg-accent-500 text-white hover:bg-accent-600 disabled:opacity-50">
          Save
        </button>
        <button type="button" onClick={onDone} className="min-h-[32px] px-3 rounded-lg text-xs text-ink-500 hover:text-ink-800">
          Close
        </button>
      </div>
    </div>
  )
}

export function DevRequestsDrawer() {
  const { isDevRequestsOpen, closeDevRequests } = useUIStore()
  const location = useLocation()
  const { data: requests = [], isLoading } = useDevRequests()
  const updateRequest = useUpdateDevRequest()
  const deleteRequest = useDeleteDevRequest()
  const reorder = useReorderDevRequests()

  const [showNewForm, setShowNewForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [categoryFilter, setCategoryFilter] = useState<DevRequestCategory | null>(null)
  const [sortMode, setSortMode] = useState<SortMode>('manual')
  const [draggingId, setDraggingId] = useState<string | null>(null)

  const active = requests.filter(r => r.status !== 'dismissed')
  const filtered = categoryFilter ? active.filter(r => r.category === categoryFilter) : active
  const sorted = sortMode === 'priority'
    ? [...filtered].sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority])
    : filtered

  function handleCycleStatus(request: DevRequest) {
    const idx = DEV_REQUEST_STATUS_CYCLE.indexOf(request.status as typeof DEV_REQUEST_STATUS_CYCLE[number])
    const next = DEV_REQUEST_STATUS_CYCLE[(idx + 1) % DEV_REQUEST_STATUS_CYCLE.length]
    updateRequest.mutate({ id: request.id, patch: { status: next } })
  }

  function handleDrop(targetId: string) {
    if (!draggingId || draggingId === targetId || sortMode !== 'manual') { setDraggingId(null); return }
    const ids = sorted.map(r => r.id)
    const from = ids.indexOf(draggingId)
    const to   = ids.indexOf(targetId)
    ids.splice(to, 0, ids.splice(from, 1)[0])
    setDraggingId(null)
    reorder.mutate(ids)
  }

  return (
    <>
      {isDevRequestsOpen && (
        <div className="fixed inset-0 z-40 bg-ink-900/10" onClick={closeDevRequests} />
      )}

      <div
        className={[
          'fixed z-50 bg-white overflow-y-auto transition-transform duration-200 border-ink-200 flex flex-col',
          'bottom-0 left-0 right-0 h-[75vh] rounded-t-2xl border-t',
          'lg:left-auto lg:right-0 lg:top-14 lg:h-auto lg:bottom-0 lg:w-96 lg:rounded-none lg:border-t-0 lg:border-l',
          isDevRequestsOpen
            ? 'translate-y-0 lg:translate-x-0'
            : 'translate-y-full lg:translate-y-0 lg:translate-x-full',
        ].join(' ')}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-ink-100 sticky top-0 bg-white z-10">
          <h2 className="text-sm font-semibold text-ink-800">🗒️ Requests & Ideas</h2>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowNewForm(v => !v)}
              className="text-xs font-semibold text-accent-600 hover:text-accent-700 min-h-[44px] px-2 rounded"
            >
              + New
            </button>
            <button
              onClick={closeDevRequests}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center text-ink-400 hover:text-ink-700 transition-colors duration-150 text-xl leading-none rounded"
            >
              ×
            </button>
          </div>
        </div>

        {showNewForm && (
          <NewRequestForm currentPage={location.pathname} onDone={() => setShowNewForm(false)} />
        )}

        {/* Filters + sort */}
        <div className="flex items-center gap-1.5 px-3 py-2 border-b border-ink-100 flex-wrap">
          {/* "all" now matches the accent-based selected/unselected convention
              used for filter pills elsewhere in the app (Shop/Games category
              filters) instead of a one-off dark-gray style; the unselected
              state also gets a light fill (not plain white) so it doesn't
              read as an empty/unstyled box against the drawer's white
              background. */}
          <button
            onClick={() => setCategoryFilter(null)}
            className={`text-[10px] px-2 min-h-[28px] rounded border font-medium transition-colors ${
              categoryFilter === null ? 'bg-accent-500 text-white border-accent-500' : 'bg-ink-50 text-ink-600 border-ink-200'
            }`}
          >
            all {active.length}
          </button>
          {CATEGORIES.map(c => {
            const count = active.filter(r => r.category === c).length
            if (count === 0) return null
            return (
              <button
                key={c}
                onClick={() => setCategoryFilter(f => f === c ? null : c)}
                className={`text-[10px] px-2 min-h-[28px] rounded border transition-colors ${
                  categoryFilter === c ? CATEGORY_BADGE[c] + ' font-semibold' : 'bg-ink-50 text-ink-600 border-ink-200'
                }`}
              >
                {c} {count}
              </button>
            )
          })}
          <button
            onClick={() => setSortMode(m => m === 'manual' ? 'priority' : 'manual')}
            className="ml-auto text-[10px] px-2 min-h-[28px] rounded border border-ink-200 text-ink-500 hover:text-ink-800"
            title="Toggle sort order"
          >
            {sortMode === 'manual' ? '↕ manual' : '⚡ priority'}
          </button>
        </div>

        {/* List */}
        <div className="flex-1 p-2.5 flex flex-col gap-1.5">
          {isLoading ? (
            [1, 2, 3].map(i => <div key={i} className="h-14 bg-cream-100 rounded-xl animate-pulse" />)
          ) : sorted.length === 0 ? (
            <p className="text-xs text-ink-300 text-center py-8">
              {categoryFilter ? 'Nothing in this category' : 'Nothing yet — tap "+ New" to jot something down'}
            </p>
          ) : (
            sorted.map(request => (
              <div
                key={request.id}
                onDragOver={e => sortMode === 'manual' && e.preventDefault()}
                onDrop={() => handleDrop(request.id)}
              >
                {editingId === request.id ? (
                  <EditRequestForm request={request} onDone={() => setEditingId(null)} />
                ) : (
                  <DevRequestCard
                    request={request}
                    dragging={draggingId === request.id}
                    onDragStart={() => setDraggingId(request.id)}
                    onDragEnd={() => setDraggingId(null)}
                    onCycleStatus={() => handleCycleStatus(request)}
                    onDelete={() => { if (confirm(`Delete "${request.title}"?`)) deleteRequest.mutate(request.id) }}
                    onEdit={() => setEditingId(request.id)}
                  />
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </>
  )
}
