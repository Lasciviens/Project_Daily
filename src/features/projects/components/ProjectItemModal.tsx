import { useEffect, useState } from 'react'
import { Dialog, DialogPanel, DialogBackdrop } from '@headlessui/react'
import { toast } from '../../../app/store'
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
  open:        boolean
  onClose:     () => void
  projectId:   string
  phases:      ProjectPhase[]
  defaultPhaseId?: string
  item?:       ProjectItem | null   // present → edit mode; absent → add mode
}

const inputCls = 'w-full min-h-[44px] px-3 rounded-lg border border-ink-200 bg-cream-50 text-sm text-ink-800 focus:outline-none focus:ring-2 focus:ring-accent-300'

export function ProjectItemModal({ open, onClose, projectId, phases, defaultPhaseId, item }: Props) {
  const isEdit = !!item

  const [title,    setTitle]    = useState('')
  const [notes,    setNotes]    = useState('')
  const [phaseId,  setPhaseId]  = useState('')
  const [type,     setType]     = useState<ItemType>('improvement')
  const [status,   setStatus]   = useState<ItemStatus>('open')
  const [priority, setPriority] = useState<ItemPriority>('medium')

  const createItem = useCreateItem(projectId)
  const updateItem = useUpdateItem(projectId)
  const saving = createItem.isPending || updateItem.isPending

  useEffect(() => {
    if (!open) return
    if (item) {
      setTitle(item.title)
      setNotes(item.notes ?? '')
      setPhaseId(item.phase_id)
      setType(item.type)
      setStatus(item.status)
      setPriority(item.priority)
    } else {
      setTitle('')
      setNotes('')
      setPhaseId(defaultPhaseId ?? phases[0]?.id ?? '')
      setType('improvement')
      setStatus('open')
      setPriority('medium')
    }
  }, [open, item, defaultPhaseId, phases])

  async function handleSave() {
    const trimmed = title.trim()
    if (!trimmed) { toast.error('Title is required'); return }
    if (!phaseId) { toast.error('Phase is required'); return }

    const tid = toast.loading(isEdit ? 'Saving item…' : 'Creating item…')
    try {
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
      toast.dismiss(tid)
      toast.success(isEdit ? 'Item saved ✓' : 'Item created ✓')
      onClose()
    } catch (err) {
      toast.dismiss(tid)
      toast.error((err as Error).message ?? 'Failed to save item')
    }
  }

  return (
    <Dialog open={open} onClose={onClose} className="relative z-[60]">
      <DialogBackdrop transition className="fixed inset-0 bg-ink-950/30 transition duration-200 data-[closed]:opacity-0" />
      <div className="fixed inset-0 flex items-end sm:items-center justify-center p-0 sm:p-4">
        <DialogPanel transition className="w-full rounded-t-2xl sm:rounded-2xl sm:max-w-md max-h-[90vh] overflow-y-auto bg-cream-50 border border-ink-200 transition duration-200 data-[closed]:opacity-0 data-[closed]:translate-y-4 sm:data-[closed]:translate-y-0 sm:data-[closed]:scale-95">
          <div className="p-4 sm:p-5 flex flex-col gap-3">
            <h2 className="text-base font-bold text-ink-900">{isEdit ? 'Edit item' : 'New item'}</h2>

            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-ink-500">Title</label>
              <input
                autoFocus
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="Item title…"
                className={inputCls}
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-ink-500">Notes</label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Add notes…"
                rows={3}
                className={`${inputCls} min-h-[80px] py-2 resize-none`}
              />
            </div>

            {phases.length > 1 && (
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-ink-500">Phase</label>
                <select value={phaseId} onChange={e => setPhaseId(e.target.value)} className={inputCls}>
                  {phases.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="grid grid-cols-3 gap-2">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-ink-500">Type</label>
                <select value={type} onChange={e => setType(e.target.value as ItemType)} className={inputCls}>
                  {TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-ink-500">Status</label>
                <select value={status} onChange={e => setStatus(e.target.value as ItemStatus)} className={inputCls}>
                  {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-ink-500">Priority</label>
                <select value={priority} onChange={e => setPriority(e.target.value as ItemPriority)} className={inputCls}>
                  {PRIORITY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 mt-2">
              <button
                type="button"
                onClick={onClose}
                className="min-h-[44px] px-4 rounded-xl text-sm font-semibold text-ink-600 hover:bg-ink-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="min-h-[44px] px-4 rounded-xl bg-accent-600 text-white text-sm font-semibold hover:bg-accent-700 transition-colors disabled:opacity-50"
              >
                {isEdit ? 'Save' : 'Create'}
              </button>
            </div>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  )
}
