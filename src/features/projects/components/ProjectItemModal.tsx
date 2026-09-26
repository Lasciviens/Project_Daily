import { useState } from 'react'
import { toast } from '../../../app/store'
import { ModalShell } from '../../../shared/modals/ModalShell'
import { Button } from '../../../shared/ui'
import { withProgress } from '../../../shared/hooks/useMutationWithFeedback'
import { useCreateItem, useUpdateItem } from '../hooks/useProjects'
import type { ProjectItem, ProjectPhase, ItemType, ItemStatus, ItemPriority } from '../types'

const TYPE_OPTIONS: Array<{ value: ItemType; label: string }> = [
  { value: 'update',      label: 'Update' },
  { value: 'improvement', label: 'Improvement' },
  { value: 'ui_request',  label: 'UI request' },
  { value: 'bug',         label: 'Bug' },
  { value: 'wishlist',    label: 'Wishlist' },
]

const STATUS_OPTIONS: Array<{ value: ItemStatus; label: string }> = [
  { value: 'open',        label: 'Open' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'done',        label: 'Done' },
  { value: 'cancelled',   label: 'Cancelled' },
]

const PRIORITY_OPTIONS: Array<{ value: ItemPriority; label: string }> = [
  { value: 'low',    label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high',   label: 'High' },
]

interface Props {
  /** Controlled callers pass it; the `project-item` entity modal omits it. */
  open?:       boolean
  onClose:     () => void
  projectId:   string
  phases:      ProjectPhase[]
  defaultPhaseId?: string
  item?:       ProjectItem | null   // present → edit mode; absent → add mode
}

export function ProjectItemModal({ open = true, onClose, projectId, phases, defaultPhaseId, item }: Props) {
  const isEdit = !!item

  // Seeded once per mount — every caller mounts this popup fresh for one item.
  const [title,    setTitle]    = useState(item?.title ?? '')
  const [notes,    setNotes]    = useState(item?.notes ?? '')
  const [phaseId,  setPhaseId]  = useState(item?.phase_id ?? defaultPhaseId ?? phases[0]?.id ?? '')
  const [type,     setType]     = useState<ItemType>(item?.type ?? 'improvement')
  const [status,   setStatus]   = useState<ItemStatus>(item?.status ?? 'open')
  const [priority, setPriority] = useState<ItemPriority>(item?.priority ?? 'medium')

  const createItem = useCreateItem(projectId)
  const updateItem = useUpdateItem(projectId)
  const saving = createItem.isPending || updateItem.isPending


  async function handleSave() {
    const trimmed = title.trim()
    if (!trimmed) { toast.error('Title is required'); return }
    if (!phaseId) { toast.error('Phase is required'); return }

    // The item hooks toast + log failures themselves; this adds the per-call copy.
    const ok = await withProgress(async () => {
      if (isEdit && item) {
        await updateItem.mutateAsync({
          id: item.id,
          patch: { title: trimmed, notes: notes.trim() || null, type, status, priority, phase_id: phaseId },
        })
      } else {
        await createItem.mutateAsync({
          phase_id: phaseId,
          project_id: projectId,
          title: trimmed,
          type,
          status,
          priority,
          notes: notes.trim() || null,
        })
      }
      return true
    }, { loading: isEdit ? 'Saving item…' : 'Creating item…', success: isEdit ? 'Item saved' : 'Item created' })
    if (ok) onClose()
  }

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit item' : 'New item'}
      size="sm"
      dismissible={!saving}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="primary" onClick={handleSave} loading={saving}>{isEdit ? 'Save item' : 'Create item'}</Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <div>
          <label htmlFor="pim-title" className="field-label">Title</label>
          <input id="pim-title" autoFocus value={title} onChange={e => setTitle(e.target.value)} placeholder="Item title…" className="input" />
        </div>

        <div>
          <label htmlFor="pim-notes" className="field-label">Notes</label>
          <textarea id="pim-notes" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Add notes…" rows={3}
            className="input min-h-[80px] resize-none" />
        </div>

        {phases.length > 1 && (
          <div>
            <label htmlFor="pim-phase" className="field-label">Phase</label>
            <select id="pim-phase" value={phaseId} onChange={e => setPhaseId(e.target.value)} className="select">
              {phases.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <div>
            <label htmlFor="pim-type" className="field-label">Type</label>
            <select id="pim-type" value={type} onChange={e => setType(e.target.value as ItemType)} className="select">
              {TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="pim-status" className="field-label">Status</label>
            <select id="pim-status" value={status} onChange={e => setStatus(e.target.value as ItemStatus)} className="select">
              {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="pim-priority" className="field-label">Priority</label>
            <select id="pim-priority" value={priority} onChange={e => setPriority(e.target.value as ItemPriority)} className="select">
              {PRIORITY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>
      </div>
    </ModalShell>
  )
}
