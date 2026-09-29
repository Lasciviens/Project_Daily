import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Plus, ChevronRight, Trash2, ArrowUpDown, Zap, Sparkles, Check, PenLine } from 'lucide-react'
import { useUIStore } from '../../../app/store'
import {
  devRequestsReadFrom, useDevRequests, useUpdateDevRequest, useDeleteDevRequest, useBulkDeleteDevRequests, useReorderDevRequests,
} from '../hooks/useDevRequests'
import { discardNewDraft } from '../hooks/useDevRequestDraft'
import { DEV_REQUEST_STATUS_CYCLE } from '../api/devRequestsApi'
import { useDevRequestDrafts } from '../devRequestDraftStore'
import { CATEGORIES, isDraftEmpty, orphanEditDrafts, planReorder } from '../devRequestRules'
import { descriptionPreview } from '../devRequestContext'
import { buildClaudePrompt } from '../devRequestPrompt'
import { DEV_REQUEST_UI_ATTR } from '../pick/pickDom'
import { usePageContextReader } from '../pick/usePageContext'
import { DevRequestCard } from './DevRequestCard'
import { DevRequestEditForm, DevRequestNewForm } from './DevRequestForm'
import { pageOptionFor } from './devRequestMeta'
import { SideDrawer } from '../../../shared/modals/SideDrawer'
import { useEntityModal } from '../../../shared/modals'
import { useBreakpoint } from '../../../shared/hooks/useBreakpoint'
import { Button, Skeleton, Truncate, cx } from '../../../shared/ui'
import type { DevRequest, DevRequestCategory, DevRequestPriority } from '../types'

const PRIORITY_RANK: Record<DevRequestPriority, number> = { urgent: 0, high: 1, medium: 2, low: 3 }

const CHIP = 'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-meta font-semibold tabular-nums transition-colors duration-100 [@media(pointer:coarse)]:h-11'
const CHIP_IDLE = 'border-line bg-surface-2 text-fg-2 [@media(hover:hover)]:hover:border-line-strong [@media(hover:hover)]:hover:text-fg'
const CHIP_ON = 'border-accent-500/30 bg-accent-50 text-accent-700'

/**
 * The in-app backlog (dev_requests): jot bugs, features and ideas about the
 * app itself. Filters, sort, the open form and every unsaved word live in the
 * draft store (localStorage), so closing the drawer — which unmounts its
 * content — or reloading loses nothing. On tablet/desktop "New" opens the
 * floating composer, which stays on screen while you browse.
 */
export function DevRequestsDrawer() {
  const isOpen = useUIStore(s => s.isDevRequestsOpen)
  const close = useUIStore(s => s.closeDevRequests)
  const { pathname } = useLocation()
  const phone = useBreakpoint() === 'phone'
  const modal = useEntityModal()
  const readPage = usePageContextReader()
  const { data: requests = [], isLoading, isSuccess } = useDevRequests()
  const updateRequest = useUpdateDevRequest()
  const deleteRequest = useDeleteDevRequest()
  const bulkDelete = useBulkDeleteDevRequests()
  const reorder = useReorderDevRequests()

  const prefs = useDevRequestDrafts(s => s.drawer)
  const setDrawer = useDevRequestDrafts(s => s.setDrawer)
  const newDraft = useDevRequestDrafts(s => s.newDraft)
  const editDrafts = useDevRequestDrafts(s => s.editDrafts)
  const composer = useDevRequestDrafts(s => s.composer)
  const prompt = useDevRequestDrafts(s => s.prompt)
  const openComposer = useDevRequestDrafts(s => s.openComposer)
  const [draggingId, setDraggingId] = useState<string | null>(null)

  // Unsaved edits of requests deleted elsewhere (another device, the AI)
  // would otherwise sit in storage for ever.
  useEffect(() => {
    if (!isSuccess) return
    const gone = orphanEditDrafts(editDrafts, requests.map(r => r.id), devRequestsReadFrom())
    if (gone.length) useDevRequestDrafts.getState().pruneEditDrafts(gone)
  }, [isSuccess, requests, editDrafts])

  const { categories, sortMode, showDone, newFormOpen, editingId, selecting } = prefs
  const picked = new Set(prefs.picked)
  const categoryFilters = new Set(categories)

  function togglePicked(id: string) {
    setDrawer({ picked: picked.has(id) ? prefs.picked.filter(x => x !== id) : [...prefs.picked, id] })
  }
  function startSelecting() { setDrawer({ selecting: true, picked: prompt.ids.filter(id => requests.some(r => r.id === id)) }) }
  function stopSelecting() { setDrawer({ selecting: false, picked: [] }) }

  function toggleCategoryFilter(c: DevRequestCategory) {
    setDrawer({ categories: categoryFilters.has(c) ? categories.filter(x => x !== c) : [...categories, c] })
  }

  // Tablet/desktop write in the floating composer; phones in the inline form.
  function openNew() {
    if (phone) { setDrawer({ newFormOpen: !newFormOpen }); return }
    useDevRequestDrafts.getState().beginNewDraft(readPage(), pageOptionFor(pathname))
    openComposer({ kind: 'new' })
    close()
  }
  function popOutNew() {
    setDrawer({ newFormOpen: false })
    openComposer({ kind: 'new' })
    close()
  }
  function popOutEdit(id: string) {
    setDrawer({ editingId: null })
    openComposer({ kind: 'edit', id })
    close()
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
    if (!ok) return
    const ids = [...closedIds]
    // Drafts go only once the rows are gone: a failed delete keeps unsaved edits.
    try { await bulkDelete.mutateAsync(ids) } catch { return }
    useDevRequestDrafts.getState().pruneEditDrafts(ids)
  }

  async function handleDelete(request: DevRequest) {
    const ok = await modal.confirm({ title: `Delete "${request.title}"?`, confirmLabel: 'Delete', destructive: true })
    if (!ok) return
    try { await deleteRequest.mutateAsync(request.id) } catch { return }
    useDevRequestDrafts.getState().clearEditDraft(request.id)
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
    const changes = planReorder(requests, ids)
    if (changes.length) reorder.mutate(changes)
  }

  async function handleBuildPrompt() {
    const rows = requests.filter(r => picked.has(r.id))
    if (rows.length === 0) return
    const same = rows.length === prompt.ids.length && rows.every(r => prompt.ids.includes(r.id))
    if (prompt.edited && prompt.text.trim() && !same) {
      const ok = await modal.confirm({
        title: 'Replace your edited prompt?',
        message: 'The prompt in the composer has your own edits. Building a new one replaces them.',
        confirmLabel: 'Replace',
      })
      if (!ok) return
    }
    const s = useDevRequestDrafts.getState()
    if (!(same && prompt.edited)) s.setPrompt(rows.map(r => r.id), buildClaudePrompt(rows))
    setDrawer({ selecting: false })
    openComposer(composer.target, 'prompt')
    close()
  }

  const renderRow = (request: DevRequest, draggable: boolean) => {
    if (selecting) {
      const on = picked.has(request.id)
      const preview = descriptionPreview(request.description)
      return (
        <button
          type="button"
          onClick={() => togglePicked(request.id)}
          aria-pressed={on}
          className={cx(
            'flex min-h-[44px] w-full items-start gap-2.5 rounded-row border px-3 py-2.5 text-left transition-colors',
            on ? 'border-accent-500/40 bg-accent-50' : 'border-line bg-surface [@media(hover:hover)]:hover:border-line-strong',
          )}
        >
          <span className={cx(
            'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border',
            on ? 'border-accent-500 bg-accent-500 text-on-accent' : 'border-line-strong bg-surface',
          )}>
            {on && <Check className="h-3.5 w-3.5" aria-hidden />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-body font-medium text-fg">{request.title}</span>
            {preview && <Truncate lines={2} className="mt-0.5 text-meta text-fg-2">{preview}</Truncate>}
            <span className="mt-0.5 block text-meta text-fg-muted">{request.category} · {request.priority}{request.page && request.page !== 'other' ? ` · ${request.page}` : ''}</span>
          </span>
        </button>
      )
    }
    if (editingId === request.id) {
      // A save can land after the form moved on to another request: close only this one.
      const closeEdit = () => { if (useDevRequestDrafts.getState().drawer.editingId === request.id) setDrawer({ editingId: null }) }
      return <DevRequestEditForm request={request} onClose={closeEdit} onPopOut={() => popOutEdit(request.id)} />
    }
    return (
      <DevRequestCard
        request={request}
        hasDraft={request.id in editDrafts}
        dragging={draggable && draggingId === request.id}
        onDragStart={() => { if (draggable) setDraggingId(request.id) }}
        onDragEnd={() => setDraggingId(null)}
        onCycleStatus={() => handleCycleStatus(request)}
        onDelete={() => void handleDelete(request)}
        onEdit={() => setDrawer({ editingId: request.id })}
      />
    )
  }

  const filters = (
    <div className="flex flex-col gap-1.5 px-4 pb-2.5 sm:px-5">
      <div className="scroll-x flex items-center gap-1.5 sm:flex-wrap">
        <button
          type="button"
          onClick={() => setDrawer({ categories: [] })}
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
          onClick={() => setDrawer({ sortMode: sortMode === 'manual' ? 'priority' : 'manual' })}
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

  // A draft that is neither in the composer nor in the open form: say so, so
  // it is never forgotten.
  // (On tablet/desktop the composer is tucked away while this drawer is
  // open, so its draft is announced here too; Continue brings it back.)
  const composerHasNew = composer.open && composer.target.kind === 'new'
  const showDraftBanner = !selecting && !isDraftEmpty(newDraft) && (phone ? !newFormOpen && !composerHasNew : true)

  return (
    <SideDrawer
      open={isOpen}
      onClose={close}
      title="Requests & ideas"
      headerActions={
        <>
          <Button
            variant="ghost"
            size="sm"
            icon={<Sparkles />}
            onClick={() => (selecting ? stopSelecting() : startSelecting())}
            aria-pressed={selecting}
            title="Pick requests and build a prompt for Claude"
          >
            {selecting ? 'Cancel' : 'Prompt'}
          </Button>
          {!selecting && (
            <Button variant="ghost" size="sm" icon={<Plus />} onClick={openNew} aria-expanded={phone ? newFormOpen : undefined} className="text-accent-600">
              New
            </Button>
          )}
        </>
      }
      headerExtra={filters}
      widthClassName="w-[28rem]"
      phoneHeight="80dvh"
    >
      <div {...{ [DEV_REQUEST_UI_ATTR]: '' }} className="scroll-y min-h-0 flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
        {phone && newFormOpen && !selecting && <DevRequestNewForm onClose={() => setDrawer({ newFormOpen: false })} onPopOut={popOutNew} />}

        {showDraftBanner && (
          <div className="mx-3 mt-3 flex items-center gap-2 rounded-row border border-line bg-surface-2 py-1.5 pl-3 pr-1.5 sm:mx-4">
            <PenLine className="h-4 w-4 shrink-0 text-fg-muted" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block text-meta text-fg-muted">{composerHasNew ? 'In the composer' : 'Unsaved draft'}</span>
              <Truncate className="text-body font-medium text-fg">{newDraft.title.trim() || descriptionPreview(newDraft.description, 60) || 'Untitled'}</Truncate>
            </span>
            <Button size="sm" variant="ghost" onClick={() => discardNewDraft()}>Discard</Button>
            <Button size="sm" onClick={() => (phone ? setDrawer({ newFormOpen: true }) : popOutNew())}>Continue</Button>
          </div>
        )}

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
                  onClick={() => setDrawer({ showDone: !showDone })}
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
      {selecting && (
        <div className="flex items-center justify-between gap-2 border-t border-line bg-surface px-4 py-2.5 pb-[calc(0.625rem+env(safe-area-inset-bottom))] sm:px-5">
          <span className="text-meta text-fg-muted">
            {picked.size === 0 ? 'Tap requests to pick them' : `${picked.size} picked`}
          </span>
          <div className="flex gap-1.5">
            {sorted.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setDrawer({ picked: sorted.map(r => r.id) })}>All open</Button>
            )}
            <Button size="sm" icon={<Sparkles />} disabled={picked.size === 0} onClick={() => void handleBuildPrompt()}>
              Build prompt
            </Button>
          </div>
        </div>
      )}
    </SideDrawer>
  )
}
