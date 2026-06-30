// ═════════════════════════════════════════════════════════════════════════════
//  UnifiedPlanModal — the single planning surface for the whole app.
//
//  ┌─ RULES (read before editing) ─────────────────────────────────────────────┐
//  │ 1. ALWAYS ON TOP. Each open instance claims the next z-index above every    │
//  │    other modal (see useTopZIndex). Never hardcode a z-class on the Dialog.  │
//  │ 2. CONFIG-DRIVEN. Callers shape the modal from THEIR file via `config`,      │
//  │    `defaults`, `source`, `scheduleExtra`/`taskExtra`, `onSaved`. Adding a    │
//  │    per-tab/per-caller variation should NOT require editing this folder —     │
//  │    add a field key + a `hide*/lock*` entry instead.                          │
//  │ 3. SINGLE SOURCE OF TRUTH. All mutable state lives in `form` (planForm.ts).  │
//  │    Title is shared: Plan title === Task title.                               │
//  │ 4. PRESENTATION IS SPLIT. Field widgets → fields.tsx; tab layouts →          │
//  │    ScheduleTab/TaskTab. This file owns state + save side-effects only.       │
//  │ 5. LOG EVERY LOGIC CHANGE in the CHANGELOG below (date · what · why).        │
//  └─────────────────────────────────────────────────────────────────────────────┘
//
//  CHANGELOG
//  2026-06-30 · v1 · Created. Merges legacy PlanModal + AddTimeBlockModal +
//                    AddTaskModal into one config-driven modal. Recurrence is now
//                    functional (one-off time block vs recurring schedule block).
//  2026-06-30 · v2 · Media feedback: default start time = next half-hour slot
//                    (planForm/nextPlanTime); 24h-only time field (Time24Field,
//                    no AM/PM). Cross-table consistency: when "also create task"
//                    is on, task is created FIRST and the time block links to it
//                    (source_type='task') — fixes time_blocks_source_type_check
//                    violation from passing 'media'. Callers now pass a VALID
//                    time_blocks source_type for the no-task path.
// ═════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react'
import { Dialog, DialogPanel, DialogBackdrop } from '@headlessui/react'
import { toast, useCalendarStore } from '../../../app/store'
import { useCreateTimeBlock, useCreateScheduleBlock } from '../../../features/daily/hooks/useSchedule'
import { useCreateTask, useUpdateTask, useDeleteTask } from '../../../features/todo/hooks/useTodos'
import { createCalendarEvent } from '../../../features/calendar/api/calendarApi'
import { ScheduleTab } from './ScheduleTab'
import { TaskTab } from './TaskTab'
import { buildInitialForm } from './planForm'
import {
  resolveTabs, resolveDefaultTab, daysForRecurrence, endTimeFrom, sectionForDate, LOCAL_TZ,
} from './planModal.config'
import type { PlanForm } from './planForm'
import type { PlanTab, UnifiedPlanModalProps } from './planModal.types'

// ── z-index stacking — newest open modal always wins ──────────────────────────
let zCursor = 1000
function useTopZIndex(open: boolean): number {
  const [z, setZ] = useState(1000)
  useEffect(() => {
    if (open) { zCursor += 10; setZ(zCursor) }
  }, [open])
  return z
}

const TAB_LABELS: Record<PlanTab, string> = { schedule: 'Schedule', task: 'Task' }

export function UnifiedPlanModal({
  open, onClose, config, defaults, source, task, scheduleExtra, taskExtra, onSaved,
}: UnifiedPlanModalProps) {
  const tabs       = resolveTabs(config)
  const editMode   = !!task
  const zIndex     = useTopZIndex(open)

  const [activeTab, setActiveTab] = useState<PlanTab>(resolveDefaultTab(config, tabs))
  const [form,      setForm]      = useState<PlanForm>(() => buildInitialForm(defaults, task))
  const [saving,    setSaving]    = useState(false)

  const calToken    = useCalendarStore(s => s.accessToken)
  const createBlock = useCreateTimeBlock()
  const createRecur = useCreateScheduleBlock()
  const createTask  = useCreateTask()
  const updateTask  = useUpdateTask()
  const deleteTask  = useDeleteTask()

  // Re-seed whenever the modal (re)opens or its inputs change.
  useEffect(() => {
    if (!open) return
    setForm(buildInitialForm(defaults, task))
    setActiveTab(resolveDefaultTab(config, tabs))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, task])

  const patch = (p: Partial<PlanForm>) => setForm(f => ({ ...f, ...p }))

  // ── Save: Schedule tab ──────────────────────────────────────────────────────
  //  Order matters for cross-table consistency: create the task FIRST so the
  //  time block can link to it (source_type='task'), matching the rest of the
  //  app (AddTaskModal). Only when no task is created does the block link to the
  //  caller's source entity — whose `sourceType` MUST be a valid time_blocks
  //  source_type ('movie'|'tv_episode'|'training_session'|'project_item'|…).
  async function saveSchedule() {
    const effDuration = form.customMin !== '' ? Number(form.customMin) || 60 : form.duration
    let recurringCreated = false
    let linkedTaskId: string | undefined

    if (form.alsoCreateTask) {
      // Map category → task domain (enum: personal | work | media).
      const taskDomain = form.category === 'work' ? 'work' : form.category === 'media' ? 'media' : 'personal'
      const { task: created, googleTaskError } = await createTask.mutateAsync({
        title:       form.title.trim(),
        section:     sectionForDate(form.date),
        domain:      taskDomain,
        priority:    'medium',
        due_date:    form.date,
        source_type: source?.taskSourceType,
        source_id:   source?.sourceId,
      })
      if (googleTaskError) toast.error(`Google Tasks sync failed: ${googleTaskError}`)
      linkedTaskId = created.id
    }

    if (form.recurrence === 'none') {
      const link = linkedTaskId
        ? { source_type: 'task', source_id: linkedTaskId }
        : { source_type: source?.sourceType, source_id: source?.sourceId }
      await createBlock.mutateAsync({
        date:             form.date,
        title:            form.title.trim(),
        start_time:       `${form.startTime}:00`,
        duration_minutes: effDuration,
        color:            defaults?.color,
        category:         form.category,
        ...link,
      })
    } else {
      await createRecur.mutateAsync({
        title:        form.title.trim(),
        days_of_week: daysForRecurrence(form.recurrence, form.weeklyDays),
        start_time:   `${form.startTime}:00`,
        end_time:     `${endTimeFrom(form.startTime, effDuration)}:00`,
        color:        defaults?.color ?? 'blue',
      })
      recurringCreated = true
    }

    if (form.gcal && calToken && form.recurrence === 'none') {
      try {
        const startISO = new Date(`${form.date}T${form.startTime}:00`).toISOString()
        const endISO   = new Date(new Date(`${form.date}T${form.startTime}:00`).getTime() + effDuration * 60_000).toISOString()
        await createCalendarEvent(calToken, 'primary', {
          summary: form.title.trim(),
          start:   { dateTime: startISO, timeZone: LOCAL_TZ },
          end:     { dateTime: endISO,   timeZone: LOCAL_TZ },
        })
      } catch {
        toast.error('Planned locally, Google Calendar sync failed')
      }
    }

    onSaved?.({ tab: 'schedule', taskId: linkedTaskId, timeBlockCreated: !recurringCreated, recurringCreated })
  }

  // ── Save: Task tab ───────────────────────────────────────────────────────────
  async function saveTask() {
    if (editMode && task) {
      await updateTask.mutateAsync({
        id: task.id,
        patch: {
          title:       form.title.trim(),
          description: form.notes.trim() || null,
          section:     form.section,
          priority:    form.priority,
          domain:      form.domain,
          due_date:    form.dueDate || null,
          due_time:    form.dueTime ? `${form.dueTime}:00` : null,
        },
      })
      onSaved?.({ tab: 'task', taskId: task.id })
      return
    }

    const { task: created, googleTaskError } = await createTask.mutateAsync({
      title:       form.title.trim(),
      section:     form.section,
      priority:    form.priority,
      domain:      form.domain,
      due_date:    form.dueDate || null,
      source_type: source?.taskSourceType,
      source_id:   source?.sourceId,
    })
    if (googleTaskError) toast.error(`Google Tasks sync failed: ${googleTaskError}`)

    // Auto-schedule personal tasks with a due date (mirrors legacy AddTaskModal).
    if (form.domain === 'personal' && form.dueDate) {
      const weekend = [0, 6].includes(new Date(form.dueDate + 'T00:00:00').getDay())
      const startHH = weekend ? '12:00' : '17:00'
      await createBlock.mutateAsync({
        date:             form.dueDate,
        title:            form.title.trim(),
        start_time:       `${startHH}:00`,
        duration_minutes: 60,
        color:            'accent',
        category:         'daily',
        source_type:      'task',
        source_id:        created.id,
      })
      if (form.gcal && calToken) {
        try {
          const startISO = new Date(`${form.dueDate}T${startHH}:00`).toISOString()
          const endISO   = new Date(new Date(`${form.dueDate}T${startHH}:00`).getTime() + 60 * 60_000).toISOString()
          await createCalendarEvent(calToken, 'primary', {
            summary: form.title.trim(),
            start:   { dateTime: startISO, timeZone: LOCAL_TZ },
            end:     { dateTime: endISO,   timeZone: LOCAL_TZ },
          })
        } catch {
          toast.error('Saved locally, Google Calendar sync failed')
        }
      }
    }
    onSaved?.({ tab: 'task', taskId: created.id })
  }

  async function handleSave() {
    if (!form.title.trim()) { toast.error('Title is required'); return }
    setSaving(true)
    const tid = toast.loading(editMode ? 'Saving…' : 'Planning…')
    try {
      if (activeTab === 'schedule') await saveSchedule()
      else                          await saveTask()
      toast.dismiss(tid); toast.success(editMode ? 'Saved ✓' : 'Planned ✓')
      onClose()
    } catch (err) {
      toast.dismiss(tid); toast.error((err as Error).message ?? 'Failed')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!task) return
    if (!confirm('Delete this task?')) return
    const tid = toast.loading('Deleting…')
    try {
      await deleteTask.mutateAsync(task)
      toast.dismiss(tid); toast.success('Deleted ✓')
      onClose()
    } catch (err) {
      toast.dismiss(tid); toast.error((err as Error).message ?? 'Failed')
    }
  }

  const primaryLabel = saving
    ? (editMode ? 'Saving…' : 'Planning…')
    : activeTab === 'task' ? (editMode ? 'Save Changes' : 'Add Task') : 'Plan it'

  return (
    <Dialog open={open} onClose={onClose} className="relative" style={{ zIndex }}>
      <DialogBackdrop
        transition
        className="fixed inset-0 bg-ink-900/30 transition duration-200 data-[closed]:opacity-0"
      />
      <div className="fixed inset-0 flex items-end sm:items-center justify-center p-0 sm:p-4">
        <DialogPanel
          transition
          className="w-full rounded-t-2xl sm:rounded-2xl sm:max-w-md max-h-[90vh] overflow-y-auto bg-white border border-ink-200 transition duration-200 data-[closed]:opacity-0 data-[closed]:translate-y-4 sm:data-[closed]:translate-y-0 sm:data-[closed]:scale-95"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-ink-100 sticky top-0 bg-white z-10">
            <h2 className="text-base font-bold text-ink-900">{config?.heading ?? 'Plan'}</h2>
            <button
              type="button" onClick={onClose}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center text-ink-400 hover:text-ink-700 text-xl"
            >×</button>
          </div>

          {/* Tabs — only when more than one is available */}
          {tabs.length > 1 && (
            <div className="flex gap-1 mx-5 mt-4 bg-cream-100 p-1 rounded-lg">
              {tabs.map(t => (
                <button
                  key={t} type="button" onClick={() => setActiveTab(t)}
                  className={`flex-1 text-xs min-h-[40px] rounded-md font-medium transition-colors ${
                    activeTab === t ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500'
                  }`}
                >{TAB_LABELS[t]}</button>
              ))}
            </div>
          )}

          {activeTab === 'schedule'
            ? <ScheduleTab form={form} patch={patch} config={config} gcalAvailable={!!calToken} extra={scheduleExtra} />
            : <TaskTab form={form} patch={patch} config={config} gcalAvailable={!!calToken} editMode={editMode} extra={taskExtra} />
          }

          {/* Footer */}
          <div className="px-5 py-4 border-t border-ink-100 flex gap-3 sticky bottom-0 bg-white">
            <button
              type="button" onClick={onClose}
              className="flex-1 min-h-[44px] border border-ink-200 text-ink-700 rounded-xl text-sm font-medium hover:bg-cream-50 transition-colors"
            >Cancel</button>
            <button
              type="button" onClick={handleSave} disabled={saving || !form.title.trim()}
              className="flex-1 min-h-[44px] bg-accent-500 text-white rounded-xl text-sm font-semibold hover:bg-accent-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >{primaryLabel}</button>
          </div>

          {activeTab === 'task' && editMode && (
            <div className="px-5 pb-5">
              <button
                type="button" onClick={handleDelete} disabled={saving}
                className="w-full min-h-[44px] text-sm font-medium text-red-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-40"
              >Delete Task</button>
            </div>
          )}
        </DialogPanel>
      </div>
    </Dialog>
  )
}
