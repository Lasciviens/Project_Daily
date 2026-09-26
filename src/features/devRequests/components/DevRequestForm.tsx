import { useState } from 'react'
import { useCreateDevRequest, useUpdateDevRequest } from '../hooks/useDevRequests'
import { PAGE_OPTIONS, pageOptionFor } from './devRequestMeta'
import type { DevRequest, DevRequestCategory, DevRequestPriority, DevRequestEffort } from '../types'
import { Button, cx } from '../../../shared/ui'

const CATEGORIES: DevRequestCategory[] = ['bug', 'feature', 'improvement', 'integration', 'longterm', 'question', 'other']
const PRIORITIES: DevRequestPriority[] = ['low', 'medium', 'high', 'urgent']
const EFFORTS: DevRequestEffort[] = ['small', 'medium', 'large']

/**
 * New / edit form for one request. With `request` it edits (Save, Done /
 * Reopen, Close); without, it creates with the current page preselected.
 */
export function DevRequestForm({ request, currentPage = '', onDone }: {
  request?: DevRequest
  currentPage?: string
  onDone: () => void
}) {
  const create = useCreateDevRequest()
  const update = useUpdateDevRequest()
  const [title, setTitle] = useState(request?.title ?? '')
  const [description, setDescription] = useState(request?.description ?? '')
  const [page, setPage] = useState(pageOptionFor(request ? request.page ?? '' : currentPage))
  const [category, setCategory] = useState<DevRequestCategory>(request?.category ?? 'feature')
  const [priority, setPriority] = useState<DevRequestPriority>(request?.priority ?? 'medium')
  const [effort, setEffort] = useState<DevRequestEffort | ''>(request?.effort ?? '')
  const pending = create.isPending || update.isPending

  const fields = () => ({
    title: title.trim() || request?.title || '',
    description: description.trim() || null,
    page, category, priority, effort: effort || null,
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    if (request) update.mutate({ id: request.id, patch: fields() }, { onSuccess: onDone })
    else create.mutate(fields(), { onSuccess: onDone })
  }

  // Mark done straight from the edit form (saves any field edits too).
  const isDone = request?.status === 'done'
  function handleToggleDone() {
    if (!request) return
    update.mutate({ id: request.id, patch: { ...fields(), status: isDone ? 'open' : 'done' } }, { onSuccess: onDone })
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={cx('flex flex-col gap-2', request ? 'rounded-row border border-accent-500/30 bg-accent-50/40 p-2.5' : 'border-b border-line p-3 sm:px-4')}
    >
      <input
        autoFocus={!request}
        value={title}
        onChange={e => setTitle(e.target.value)}
        placeholder="What's the request, bug or idea?"
        aria-label="Title"
        className="input"
      />
      <textarea
        value={description}
        onChange={e => setDescription(e.target.value)}
        placeholder="Details (optional) — the more context, the less back-and-forth later"
        aria-label="Details"
        rows={4}
        className="input min-h-[90px] resize-y md:min-h-[160px]"
      />
      <div className="grid grid-cols-2 gap-2">
        <select value={category} onChange={e => setCategory(e.target.value as DevRequestCategory)} aria-label="Category" className="select">
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={priority} onChange={e => setPriority(e.target.value as DevRequestPriority)} aria-label="Priority" className="select">
          {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={page} onChange={e => setPage(e.target.value)} aria-label="Page" className="select">
          {PAGE_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
          <option value="other">other</option>
        </select>
        <select value={effort} onChange={e => setEffort(e.target.value as DevRequestEffort | '')} aria-label="Effort" className="select">
          <option value="">effort?</option>
          {EFFORTS.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <Button type="submit" variant="primary" size="sm" loading={pending} disabled={!title.trim()} className={request ? undefined : 'flex-1'}>
          {request ? 'Save' : 'Add request'}
        </Button>
        {request && (
          <Button size="sm" onClick={handleToggleDone} disabled={pending}>
            {isDone ? 'Reopen' : 'Mark done'}
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={onDone} className="ml-auto">
          {request ? 'Close' : 'Cancel'}
        </Button>
      </div>
    </form>
  )
}
