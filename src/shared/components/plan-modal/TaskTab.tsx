// ─────────────────────────────────────────────────────────────────────────────
//  UnifiedPlanModal — TASK TAB
//  To-Do creation/editing. Pure view: reads `form`, writes via `patch`.
//  Field visibility comes from `config`.
// ─────────────────────────────────────────────────────────────────────────────

import { FieldLabel, PillGroup, Time24Field } from './fields'
import { TaskWindowField } from './TaskWindowField'
import { DateInput } from '../DateInput'
import { isTaskFieldHidden, isTaskFieldLocked, shiftTime, nextPlanTime } from './planModal.config'
import { DOMAIN_LABEL } from '../../../features/todo/domainColors'
import type { PlanModalConfig } from './planModal.types'
import type { PlanForm } from './planForm'
import type { TaskSection, TaskPriority, TaskDomain } from '../../../features/todo/types'

// 'tomorrow' and 'this_week' are deliberately NOT offered: neither has a home of
// its own in the UI, so picking one only made a task float like Backlog while
// claiming a date-shaped name. The TaskSection TYPE keeps both values — existing
// rows still hold them and other writers (planModal.config's sectionForDate,
// DayAgenda, ai-proxy) still produce them.
const SECTIONS: { id: TaskSection; label: string }[] = [
  { id: 'inbox',     label: 'Inbox'     },
  { id: 'today',     label: 'Today'     },
  { id: 'backlog',   label: 'Backlog'   },
]

const LEGACY_SECTION_LABEL: Partial<Record<TaskSection, string>> = {
  tomorrow:  'Tomorrow',
  this_week: 'This Week',
}

const PRIORITIES: { id: TaskPriority; label: string; dot: string }[] = [
  { id: 'low',    label: 'Low',    dot: 'bg-ink-300'    },
  { id: 'medium', label: 'Medium', dot: 'bg-accent-400' },
  { id: 'high',   label: 'High',   dot: 'bg-red-400'    },
]

const DOMAINS: { id: TaskDomain; label: string }[] = [
  { id: 'personal', label: DOMAIN_LABEL.personal },
  { id: 'work',     label: DOMAIN_LABEL.work     },
  { id: 'media',    label: DOMAIN_LABEL.media    },
]

interface Props {
  form: PlanForm
  patch: (p: Partial<PlanForm>) => void
  config?: PlanModalConfig
  gcalAvailable: boolean
  editMode: boolean
  /** True when editing a task that already has a linked Google Calendar event —
   *  the control becomes a truthful "Added ✓" readout instead of a live toggle
   *  (the idempotent save path won't create a second event either way). */
  calendarLinked?: boolean
  extra?: React.ReactNode
}

function SectionDivider({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 -mb-1">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-300">{children}</span>
      <div className="flex-1 h-px bg-ink-100" />
    </div>
  )
}

export function TaskTab({ form, patch, config, gcalAvailable, editMode: _editMode, calendarLinked, extra }: Props) {
  const hidden = (f: Parameters<typeof isTaskFieldHidden>[0]) => isTaskFieldHidden(f, config)
  const locked = (f: Parameters<typeof isTaskFieldLocked>[0]) => isTaskFieldLocked(f, config)

  // A task already parked in a retired section keeps its pill so the value is
  // visible and highlighted; moving it off is one tap and the pill then goes away.
  const sectionOptions = SECTIONS.some(s => s.id === form.section)
    ? SECTIONS
    : [...SECTIONS, { id: form.section, label: `${LEGACY_SECTION_LABEL[form.section] ?? form.section} (legacy)` }]

  return (
    <div className="px-5 py-4 flex flex-col gap-4">
      {!hidden('title') && (
        <div>
          <FieldLabel>Title <span className="text-red-400">*</span></FieldLabel>
          <textarea
            autoFocus value={form.title} disabled={locked('title')} rows={2}
            onChange={e => patch({ title: e.target.value })}
            placeholder="What needs to be done?"
            className="w-full bg-cream-50 border border-ink-200 rounded-xl px-4 py-3 text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-accent-400 resize-none disabled:opacity-60"
          />
        </div>
      )}

      {(!hidden('section') || !hidden('priority')) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {!hidden('section') && (
            <div>
              <FieldLabel>Section</FieldLabel>
              <PillGroup options={sectionOptions} value={form.section} onChange={v => patch({ section: v })} locked={locked('section')} />
            </div>
          )}
          {!hidden('priority') && (
            <div>
              <FieldLabel>Priority</FieldLabel>
              <PillGroup options={PRIORITIES} value={form.priority} onChange={v => patch({ priority: v })} locked={locked('priority')} />
            </div>
          )}
        </div>
      )}

      {!hidden('domain') && (
        <div>
          <FieldLabel>Domain</FieldLabel>
          <PillGroup options={DOMAINS} value={form.domain} onChange={v => patch({ domain: v })} locked={locked('domain')} />
        </div>
      )}

      {(!hidden('dueDate') || !hidden('dueTime')) && (
        <>
          <SectionDivider>When</SectionDivider>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {!hidden('dueDate') && (
              <div>
                <FieldLabel>Due Date</FieldLabel>
                <DateInput
                  value={form.dueDate} onChange={v => patch({ dueDate: v })}
                  className="w-full bg-cream-50 border border-ink-200 rounded-xl px-3 text-sm text-ink-900 focus:outline-none focus:ring-2 focus:ring-accent-400 min-h-[44px]"
                />
              </div>
            )}
            {!hidden('dueTime') && (
              <div>
                <FieldLabel>Due Time</FieldLabel>
                {form.dueTime ? (
                  <div className="flex items-center gap-1.5">
                    <div className="flex-1">
                      <Time24Field
                        value={form.dueTime}
                        onChange={v => patch({ dueTime: v })}
                        onShift={delta => patch({ dueTime: shiftTime(form.dueTime, delta) })}
                        locked={locked('dueTime')}
                      />
                    </div>
                    <button
                      type="button" onClick={() => patch({ dueTime: '' })} disabled={locked('dueTime')}
                      title="Clear time" aria-label="Clear time"
                      className="min-w-[36px] min-h-[36px] flex items-center justify-center text-ink-300 hover:text-red-400 transition-colors disabled:opacity-40"
                    >✕</button>
                  </div>
                ) : (
                  <button
                    type="button" onClick={() => patch({ dueTime: nextPlanTime() })} disabled={locked('dueTime')}
                    className="w-full min-h-[44px] bg-cream-50 border border-dashed border-ink-200 rounded-xl text-sm text-ink-400 hover:text-accent-600 hover:border-accent-300 transition-colors disabled:opacity-40"
                  >
                    + Set a time
                  </button>
                )}
              </div>
            )}
          </div>
          {/* The window control writes BOTH ends, so it only makes sense while the
              Due Date field it closes on is itself present. */}
          {!hidden('startDate') && !hidden('dueDate') && (
            <TaskWindowField
              startDate={form.startDate}
              dueDate={form.dueDate}
              onChange={v => patch({ startDate: v.startDate, dueDate: v.dueDate })}
              locked={locked('startDate') || locked('dueDate')}
            />
          )}
        </>
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

      {/* Caller-injected extra fields (Yol 1) */}
      {extra}

      {/* Available on create AND edit (a task planned without a calendar entry
          can be added later) — needs a due date since an event needs a date.
          When already linked it's a disabled "Added ✓" readout. */}
      {!hidden('gcal') && gcalAvailable && form.dueDate && (
        <label className={`flex items-center gap-3 min-h-[44px] ${calendarLinked ? 'cursor-default' : 'cursor-pointer'}`}>
          <input
            type="checkbox" checked={form.gcal} disabled={calendarLinked}
            onChange={e => patch({ gcal: e.target.checked })}
            className="w-4 h-4 accent-accent-500 rounded disabled:opacity-60"
          />
          <span className="text-sm text-ink-700">
            {calendarLinked ? 'Added to Google Calendar ✓' : 'Add to Google Calendar'}
          </span>
        </label>
      )}
    </div>
  )
}
