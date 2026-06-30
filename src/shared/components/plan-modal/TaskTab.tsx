// ─────────────────────────────────────────────────────────────────────────────
//  UnifiedPlanModal — TASK TAB
//  To-Do creation/editing. Mirrors the old AddTaskModal fields. Pure view:
//  reads `form`, writes via `patch`. Field visibility comes from `config`.
// ─────────────────────────────────────────────────────────────────────────────

import { FieldLabel, PillGroup } from './fields'
import { DateInput } from '../DateInput'
import { isTaskFieldHidden, isTaskFieldLocked } from './planModal.config'
import type { PlanModalConfig } from './planModal.types'
import type { PlanForm } from './planForm'
import type { TaskSection, TaskPriority, TaskDomain } from '../../../features/todo/types'

const SECTIONS: { id: TaskSection; label: string }[] = [
  { id: 'inbox',     label: 'Inbox'     },
  { id: 'today',     label: 'Today'     },
  { id: 'tomorrow',  label: 'Tomorrow'  },
  { id: 'this_week', label: 'This Week' },
  { id: 'backlog',   label: 'Backlog'   },
]

const PRIORITIES: { id: TaskPriority; label: string; dot: string }[] = [
  { id: 'low',    label: 'Low',    dot: 'bg-ink-300'    },
  { id: 'medium', label: 'Medium', dot: 'bg-accent-400' },
  { id: 'high',   label: 'High',   dot: 'bg-red-400'    },
]

const DOMAINS: { id: TaskDomain; label: string }[] = [
  { id: 'personal', label: 'Personal' },
  { id: 'work',     label: 'Work'     },
  { id: 'media',    label: 'Media'    },
]

interface Props {
  form: PlanForm
  patch: (p: Partial<PlanForm>) => void
  config?: PlanModalConfig
  gcalAvailable: boolean
  editMode: boolean
  extra?: React.ReactNode
}

export function TaskTab({ form, patch, config, gcalAvailable, editMode, extra }: Props) {
  const hidden = (f: Parameters<typeof isTaskFieldHidden>[0]) => isTaskFieldHidden(f, config)
  const locked = (f: Parameters<typeof isTaskFieldLocked>[0]) => isTaskFieldLocked(f, config)

  return (
    <div className="px-5 py-4 flex flex-col gap-4">
      {!hidden('title') && (
        <textarea
          autoFocus value={form.title} disabled={locked('title')} rows={2}
          onChange={e => patch({ title: e.target.value })}
          placeholder="What needs to be done?"
          className="w-full bg-cream-50 border border-ink-200 rounded-xl px-4 py-3 text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-accent-400 resize-none disabled:opacity-60"
        />
      )}

      {!hidden('notes') && (
        <div>
          <FieldLabel>Notes</FieldLabel>
          <textarea
            value={form.notes} disabled={locked('notes')} rows={2}
            onChange={e => patch({ notes: e.target.value })}
            placeholder="Add details (optional)"
            className="w-full bg-cream-50 border border-ink-200 rounded-xl px-4 py-3 text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-accent-400 resize-none disabled:opacity-60"
          />
        </div>
      )}

      {!hidden('section') && (
        <div>
          <FieldLabel>Section</FieldLabel>
          <PillGroup options={SECTIONS} value={form.section} onChange={v => patch({ section: v })} locked={locked('section')} />
        </div>
      )}

      {!hidden('priority') && (
        <div>
          <FieldLabel>Priority</FieldLabel>
          <PillGroup options={PRIORITIES} value={form.priority} onChange={v => patch({ priority: v })} locked={locked('priority')} />
        </div>
      )}

      {!hidden('domain') && (
        <div>
          <FieldLabel>Domain</FieldLabel>
          <PillGroup options={DOMAINS} value={form.domain} onChange={v => patch({ domain: v })} locked={locked('domain')} />
        </div>
      )}

      <div className="flex gap-3">
        {!hidden('dueDate') && (
          <div className="flex-1">
            <FieldLabel>Due Date</FieldLabel>
            <DateInput
              value={form.dueDate} onChange={v => patch({ dueDate: v })}
              className="w-full bg-cream-50 border border-ink-200 rounded-xl px-3 text-sm text-ink-900 focus:outline-none focus:ring-2 focus:ring-accent-400 min-h-[44px]"
            />
          </div>
        )}
        {!hidden('dueTime') && (
          <div className="flex-1">
            <FieldLabel>Due Time</FieldLabel>
            <input
              type="time" value={form.dueTime} disabled={locked('dueTime')}
              onChange={e => patch({ dueTime: e.target.value })}
              className="w-full bg-cream-50 border border-ink-200 rounded-xl px-3 text-sm text-ink-900 focus:outline-none focus:ring-2 focus:ring-accent-400 min-h-[44px] disabled:opacity-60"
            />
          </div>
        )}
      </div>

      {/* Caller-injected extra fields (Yol 1) */}
      {extra}

      {!hidden('gcal') && !editMode && gcalAvailable && form.dueDate && (
        <label className="flex items-center gap-3 min-h-[44px] cursor-pointer">
          <input
            type="checkbox" checked={form.gcal} onChange={e => patch({ gcal: e.target.checked })}
            className="w-4 h-4 accent-accent-500 rounded"
          />
          <span className="text-sm text-ink-700">Add to Google Calendar</span>
        </label>
      )}
    </div>
  )
}
