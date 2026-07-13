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
//  2026-07-04 · v5 · New `timeBlock` prop: Schedule-tab edit mode for a plain
//                    time_block with no linked task (e.g. a planned training
//                    session). saveSchedule updates that row in place instead
//                    of creating a new one; Delete removes it. Lets callers
//                    like NextSessionBanner/TrainingCalendar make ANY planned
//                    session clickable+editable, not just task-linked ones.
//  2026-06-30 · v4 · Task tab redesign: grouped layout (Section+Priority side
//                    by side, "When" divider above Due Date/Time, Notes moved
//                    after), 24h Time24Field for Due Time, explicit "+ Set a
//                    time" / clear affordance instead of always showing a time
//                    value — makes the auto-schedule trigger (date AND time
//                    both set) visible to the user instead of implicit.
//  2026-06-30 · v1 · Created. Merges legacy PlanModal + AddTimeBlockModal +
//                    AddTaskModal into one config-driven modal. Recurrence is now
//                    functional (one-off time block vs recurring schedule block).
//  2026-06-30 · v3 · Task↔schedule consistency: a personal task earns an auto
//                    schedule block ONLY when it has BOTH a due date and a due
//                    time (kills the 17:00 pile-up). Edit/create now sync the
//                    linked block (update/create/delete via syncTaskBlock);
//                    delete is handled in deleteTask. due_time is persisted on
//                    create so the round-trip is stable.
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
import { useQueryClient } from '@tanstack/react-query'
import { toast, useCalendarStore } from '../../../app/store'
import { useCreateTimeBlock, useCreateScheduleBlock } from '../../../features/daily/hooks/useSchedule'
import { updateTimeBlock, deleteTimeBlock } from '../../../features/daily/api/scheduleApi'
import { useCreateTask, useUpdateTask, useDeleteTask } from '../../../features/todo/hooks/useTodos'
import { createCalendarEvent } from '../../../features/calendar/api/calendarApi'
import { logError } from '../../utils/logError'
import { supabase } from '../../../integrations/supabase/client'
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
  open, onClose, config, defaults, source, task, timeBlock, scheduleExtra, taskExtra, onSaved,
}: UnifiedPlanModalProps) {
  const tabs       = resolveTabs(config)
  const editMode   = !!task || !!timeBlock
  const zIndex     = useTopZIndex(open)

  const [activeTab, setActiveTab] = useState<PlanTab>(resolveDefaultTab(config, tabs))
  const [form,      setForm]      = useState<PlanForm>(() => buildInitialForm(defaults, task, timeBlock))
  const [saving,    setSaving]    = useState(false)

  const qc          = useQueryClient()
  const calToken    = useCalendarStore(s => s.accessToken)
  const createBlock = useCreateTimeBlock()
  const createRecur = useCreateScheduleBlock()
  const createTask  = useCreateTask()
  const updateTask  = useUpdateTask()
  const deleteTask  = useDeleteTask()

  // Re-seed whenever the modal (re)opens or its inputs change.
  useEffect(() => {
    if (!open) return
    setForm(buildInitialForm(defaults, task, timeBlock))
    setActiveTab(resolveDefaultTab(config, tabs))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, task, timeBlock])

  const patch = (p: Partial<PlanForm>) => setForm(f => ({ ...f, ...p }))

  // Create a Google Calendar event for a freshly-made block and store the event
  // id back on the block, so it can be updated/deleted with the block later
  // (prevents orphaned/duplicate events). Best-effort — never blocks the save.
  async function linkCalendarEvent(blockId: string, dateStr: string, timeHHMM: string, durationMin: number, title: string) {
    if (!calToken) return
    try {
      const start = new Date(`${dateStr}T${timeHHMM}:00`)
      const end   = new Date(start.getTime() + durationMin * 60_000)
      const created = await createCalendarEvent(calToken, 'primary', {
        summary: title,
        start:   { dateTime: start.toISOString(), timeZone: LOCAL_TZ },
        end:     { dateTime: end.toISOString(),   timeZone: LOCAL_TZ },
      })
      await updateTimeBlock(blockId, { google_calendar_event_id: created.id })
      qc.invalidateQueries({ queryKey: ['calendar'] })
    } catch (err) {
      // Was a hardcoded generic message with the real cause swallowed —
      // surfacing it (expired token, missing write scope, a malformed
      // date/time producing an Invalid Date before the request is even
      // sent, etc.) so a sync failure is actually diagnosable instead of
      // needing a code change every time to find out why.
      toast.error(`Planned locally, Google Calendar sync failed: ${(err as Error).message}`)
      logError((err as Error).message, { action: 'link_calendar_event' })
    }
  }

  // ── Save: Schedule tab ──────────────────────────────────────────────────────
  //  Order matters for cross-table consistency: create the task FIRST so the
  //  time block can link to it (source_type='task'). Only when no task is created does the block link to the
  //  caller's source entity — whose `sourceType` MUST be a valid time_blocks
  //  source_type ('movie'|'tv_episode'|'training_session'|'project_item'|…).
  async function saveSchedule() {
    const effDuration = form.customMin !== '' ? Number(form.customMin) || 60 : form.duration

    // Editing an existing plain time_block (no linked task) — update it in
    // place instead of creating a new row. No recurrence/task-creation here:
    // we're editing one specific block, not turning it into a series.
    if (timeBlock && !task) {
      await updateTimeBlock(timeBlock.id, {
        date:             form.date,
        title:            form.title.trim(),
        start_time:       `${form.startTime}:00`,
        duration_minutes: effDuration,
        category:         form.category,
      })
      // updateTimeBlock auto-syncs an existing linked calendar event; if the
      // block has none yet and the user just turned gcal on, create+link one.
      if (form.gcal && calToken && !timeBlock.google_calendar_event_id) {
        await linkCalendarEvent(timeBlock.id, form.date, form.startTime, effDuration, form.title.trim())
      }
      qc.invalidateQueries({ queryKey: ['schedule'] })
      qc.invalidateQueries({ queryKey: ['calendar'] })
      onSaved?.({ tab: 'schedule', timeBlockCreated: false })
      return
    }

    let recurringCreated = false
    let linkedTaskId: string | undefined
    let createdBlockId: string | undefined

    if (form.alsoCreateTask) {
      // Caller can pin the domain/priority; otherwise derive domain from category.
      const taskDomain = defaults?.domain
        ?? (form.category === 'work' ? 'work' : form.category === 'media' ? 'media' : 'personal')
      const { task: created, googleTaskError } = await createTask.mutateAsync({
        title:       form.title.trim(),
        section:     sectionForDate(form.date),
        domain:      taskDomain,
        priority:    defaults?.priority ?? 'medium',
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
      // Only present for a single-episode plan (see PlanSource.episodeInfo) —
      // lets a DB trigger match this exact episode being marked watched back
      // to this exact block, which plain source_id (show-level only) can't.
      const episodeFields = source?.episodeInfo
        ? { season_number: source.episodeInfo.seasonNumber, episode_number: source.episodeInfo.episodeNumber }
        : {}
      const block = await createBlock.mutateAsync({
        date:             form.date,
        title:            form.title.trim(),
        start_time:       `${form.startTime}:00`,
        duration_minutes: effDuration,
        color:            defaults?.color,
        category:         form.category,
        ...link,
        ...episodeFields,
      })
      createdBlockId = block.id
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

    if (form.gcal && calToken && form.recurrence === 'none' && createdBlockId) {
      await linkCalendarEvent(createdBlockId, form.date, form.startTime, effDuration, form.title.trim())
    }

    onSaved?.({ tab: 'schedule', taskId: linkedTaskId, timeBlockCreated: !recurringCreated, recurringCreated })
  }

  // ── Save: Task tab ───────────────────────────────────────────────────────────
  // Keep a task's linked schedule block in sync. A personal task earns a block
  // ONLY when it has both a due date AND a due time (no more 17:00 pile-ups);
  // otherwise any existing auto-block is removed. Idempotent: update / create /
  // delete to converge on the desired state.
  async function syncTaskBlock(taskId: string) {
    const title     = form.title.trim()
    const startTime = form.dueTime ? `${form.dueTime}:00` : null
    const wantBlock = form.domain === 'personal' && !!form.dueDate && !!startTime

    const { data: existing } = await supabase
      .from('time_blocks').select('id, google_calendar_event_id')
      .eq('source_type', 'task').eq('source_id', taskId)
    const blocks = existing ?? []

    if (wantBlock) {
      let blockId: string
      let existingEventId: string | null = null
      if (blocks.length) {
        // updateTimeBlock auto-syncs the calendar event when time/date changed.
        await updateTimeBlock(blocks[0].id, { date: form.dueDate, start_time: startTime!, title })
        for (const b of blocks.slice(1)) await deleteTimeBlock(b.id)   // drop dupes
        blockId = blocks[0].id
        existingEventId = blocks[0].google_calendar_event_id ?? null
      } else {
        const block = await createBlock.mutateAsync({
          date: form.dueDate, title, start_time: startTime!, duration_minutes: 60,
          color: 'accent', category: 'daily', source_type: 'task', source_id: taskId,
        })
        blockId = block.id
      }
      // Only create a NEW calendar event when the block doesn't already have one
      // (avoids duplicates on re-save; an existing event was already updated above).
      if (form.gcal && calToken && !existingEventId) {
        await linkCalendarEvent(blockId, form.dueDate, form.dueTime, 60, title)
      }
    } else {
      for (const b of blocks) await deleteTimeBlock(b.id)   // also removes their calendar events
    }
    qc.invalidateQueries({ queryKey: ['schedule'] })
    qc.invalidateQueries({ queryKey: ['calendar'] })
  }

  async function saveTask() {
    const title = form.title.trim()
    if (editMode && task) {
      await updateTask.mutateAsync({
        id: task.id,
        patch: {
          title,
          description: form.notes.trim() || null,
          section:     form.section,
          priority:    form.priority,
          domain:      form.domain,
          due_date:    form.dueDate || null,
          due_time:    form.dueTime ? `${form.dueTime}:00` : null,
        },
      })
      await syncTaskBlock(task.id)
      onSaved?.({ tab: 'task', taskId: task.id })
      return
    }

    const { task: created, googleTaskError } = await createTask.mutateAsync({
      title,
      section:     form.section,
      priority:    form.priority,
      domain:      form.domain,
      due_date:    form.dueDate || null,
      due_time:    form.dueTime ? `${form.dueTime}:00` : null,
      source_type: source?.taskSourceType,
      source_id:   source?.sourceId,
    })
    if (googleTaskError) toast.error(`Google Tasks sync failed: ${googleTaskError}`)
    await syncTaskBlock(created.id)
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
    if (task) {
      if (!confirm('Delete this task?')) return
      const tid = toast.loading('Deleting…')
      try {
        await deleteTask.mutateAsync(task)
        toast.dismiss(tid); toast.success('Deleted ✓')
        onClose()
      } catch (err) {
        toast.dismiss(tid); toast.error((err as Error).message ?? 'Failed')
      }
      return
    }
    if (timeBlock) {
      if (!confirm('Delete this session?')) return
      const tid = toast.loading('Deleting…')
      try {
        await deleteTimeBlock(timeBlock.id)
        qc.invalidateQueries({ queryKey: ['schedule'] })
        qc.invalidateQueries({ queryKey: ['calendar'] })
        toast.dismiss(tid); toast.success('Deleted ✓')
        onClose()
      } catch (err) {
        toast.dismiss(tid); toast.error((err as Error).message ?? 'Failed')
      }
    }
  }

  const primaryLabel = saving
    ? (editMode ? 'Saving…' : 'Planning…')
    : activeTab === 'task'
    ? (editMode ? 'Save Changes' : 'Add Task')
    : (timeBlock && !task ? 'Save Changes' : 'Plan it')

  return (
    <Dialog open={open} onClose={onClose} className="relative" style={{ zIndex }}>
      <DialogBackdrop
        transition
        className="fixed inset-0 bg-ink-900/30 transition duration-200 data-[closed]:opacity-0"
      />
      <div className="fixed inset-0 flex items-end sm:items-center justify-center p-0 sm:p-4">
        <DialogPanel
          transition
          className="w-full rounded-t-2xl sm:rounded-2xl sm:max-w-md max-h-[90vh] overflow-y-auto bg-cream-50 border border-ink-200 transition duration-200 data-[closed]:opacity-0 data-[closed]:translate-y-4 sm:data-[closed]:translate-y-0 sm:data-[closed]:scale-95"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-ink-100 sticky top-0 bg-cream-50 z-10">
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
                    activeTab === t ? 'bg-cream-50 text-ink-900 shadow-sm' : 'text-ink-500'
                  }`}
                >{TAB_LABELS[t]}</button>
              ))}
            </div>
          )}

          {activeTab === 'schedule'
            ? <ScheduleTab
                form={form} patch={patch} config={config} gcalAvailable={!!calToken} extra={scheduleExtra}
                taskAlreadyLinked={!!timeBlock && !task && timeBlock.source_type === 'task'}
              />
            : <TaskTab form={form} patch={patch} config={config} gcalAvailable={!!calToken} editMode={editMode} extra={taskExtra} />
          }

          {/* Footer */}
          <div className="px-5 py-4 border-t border-ink-100 flex gap-3 sticky bottom-0 bg-cream-50">
            <button
              type="button" onClick={onClose}
              className="flex-1 min-h-[44px] border border-ink-200 text-ink-700 rounded-xl text-sm font-medium hover:bg-cream-50 transition-colors"
            >Cancel</button>
            <button
              type="button" onClick={handleSave} disabled={saving || !form.title.trim()}
              className="flex-1 min-h-[44px] bg-accent-500 text-white rounded-xl text-sm font-semibold hover:bg-accent-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >{primaryLabel}</button>
          </div>

          {((activeTab === 'task' && !!task) || (activeTab === 'schedule' && !!timeBlock && !task)) && (
            <div className="px-5 pb-5">
              <button
                type="button" onClick={handleDelete} disabled={saving}
                className="w-full min-h-[44px] text-sm font-medium text-red-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-40"
              >{task ? 'Delete Task' : 'Delete Session'}</button>
            </div>
          )}
        </DialogPanel>
      </div>
    </Dialog>
  )
}
