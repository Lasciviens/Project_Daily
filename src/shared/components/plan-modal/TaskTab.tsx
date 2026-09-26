// ─────────────────────────────────────────────────────────────────────────────
//  UnifiedPlanModal — TASK EDITOR (mode='task')
//  To-Do creation/editing, PLUS an optional "Add to schedule" section for at
//  most one linked one-off time_block. Pure view: reads `form`, writes via
//  `patch`. Field visibility comes from `config`.
//
//  The schedule section here is deliberately NOT the deadline (dueDate/
//  dueTime above it) — "due Friday 5pm" and "working on it Thursday
//  1-2:30pm" are two independent facts (migration 077). Toggling it off
//  removes the linked block on save; the Task itself is never affected.
// ─────────────────────────────────────────────────────────────────────────────

import { X } from 'lucide-react'
import {
  FieldLabel, Required, PillGroup, Time24Field, DateStepperField, DurationField, CategorySelect, CheckboxRow,
  SectionDivider,
} from './fields'
import { ADD_SLOT_CLASS } from './fieldStyles'
import { TaskWindowField } from './TaskWindowField'
import { GoogleListField } from './GoogleListField'
import { DateInput } from '../DateInput'
import { isTaskFieldHidden, isTaskFieldLocked, shiftTime, nextPlanTime, stepDate } from './planModal.config'
import { DOMAIN_LABEL } from '../../../features/todo/domainColors'
import { PRIORITY_LABEL, PRIORITY_TONE } from '../../../features/todo/taskTones'
import type { Tone } from '../../ui'
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
  this_week: 'This week',
}

const PRIORITIES: { id: TaskPriority; label: string; tone: Tone }[] = (['low', 'medium', 'high'] as const)
  .map(id => ({ id, label: PRIORITY_LABEL[id], tone: PRIORITY_TONE[id] }))

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
  /** True when the linked block already has a Google Calendar event — the
   *  control becomes a truthful "Added ✓" readout instead of a live toggle,
   *  since flipping it here doesn't itself create/remove the event (that
   *  happens on Save via UnifiedPlanModal's syncTaskSchedule). */
  calendarLinked?: boolean
  extra?: React.ReactNode
}

export function TaskTab({ form, patch, config, gcalAvailable, calendarLinked, extra }: Props) {
  const hidden = (f: Parameters<typeof isTaskFieldHidden>[0]) => isTaskFieldHidden(f, config)
  const locked = (f: Parameters<typeof isTaskFieldLocked>[0]) => isTaskFieldLocked(f, config)

  // A task already parked in a retired section keeps its pill so the value is
  // visible and highlighted; moving it off is one tap and the pill then goes away.
  const sectionOptions = SECTIONS.some(s => s.id === form.section)
    ? SECTIONS
    : [...SECTIONS, { id: form.section, label: `${LEGACY_SECTION_LABEL[form.section] ?? form.section} (legacy)` }]

  return (
    <div className="flex flex-col gap-4">
      {!hidden('title') && (
        <div>
          <FieldLabel>Title<Required /></FieldLabel>
          <textarea
            autoFocus value={form.title} disabled={locked('title')} rows={2}
            onChange={e => patch({ title: e.target.value })}
            placeholder="What needs to be done?"
            className="input resize-none disabled:opacity-60"
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

      {/* Google connection required — this field is meaningless without one,
          same gating as the gcal checkbox further down. */}
      {!hidden('googleList') && gcalAvailable && (
        <GoogleListField
          value={form.googleListTitle}
          onChange={v => patch({ googleListTitle: v })}
          locked={locked('googleList')}
        />
      )}

      {(!hidden('dueDate') || !hidden('dueTime')) && (
        <>
          <SectionDivider>Deadline</SectionDivider>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {!hidden('dueDate') && (
              <div>
                <FieldLabel>Due date</FieldLabel>
                <DateInput
                  value={form.dueDate} onChange={v => patch({ dueDate: v })}
                  className="input tabular-nums"
                />
              </div>
            )}
            {!hidden('dueTime') && (
              <div>
                <FieldLabel>Due time</FieldLabel>
                {form.dueTime ? (
                  <div className="flex items-center gap-1.5">
                    <div className="min-w-0 flex-1">
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
                      className="icon-btn text-fg-faint hover:text-danger disabled:opacity-40"
                    ><X className="h-4 w-4" aria-hidden /></button>
                  </div>
                ) : (
                  <button
                    type="button" onClick={() => patch({ dueTime: nextPlanTime() })} disabled={locked('dueTime')}
                    className={ADD_SLOT_CLASS}
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
            className="input resize-none disabled:opacity-60"
          />
        </div>
      )}

      {/* ── Add to schedule — an OPTIONAL, separate fact from the deadline
          above. At most one linked one-off time_block per task (DB-enforced,
          migration 077); toggling off removes it on save, the Task survives. */}
      {!hidden('scheduled') && (
        <>
          <SectionDivider>Schedule</SectionDivider>
          <CheckboxRow
            checked={form.scheduled} onChange={v => patch({ scheduled: v })}
            label={form.scheduled ? 'Scheduled' : 'Add to schedule'}
            disabled={locked('scheduled')}
          />
          {form.scheduled && (
            <div className="ml-1 flex flex-col gap-4 border-l-2 border-line pl-1">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pl-3">
                <div>
                  <FieldLabel>Date</FieldLabel>
                  <DateStepperField
                    value={form.date} onChange={v => patch({ date: v })}
                    onStep={dir => patch({ date: stepDate(form.date, dir) })} locked={locked('scheduled')}
                  />
                </div>
                <div>
                  <FieldLabel>Start time (24h)</FieldLabel>
                  <Time24Field
                    value={form.startTime} onChange={v => patch({ startTime: v })}
                    onShift={delta => patch({ startTime: shiftTime(form.startTime, delta) })} locked={locked('scheduled')}
                  />
                </div>
              </div>
              <div className="pl-3">
                <FieldLabel>Duration</FieldLabel>
                <DurationField
                  duration={form.duration} customMin={form.customMin}
                  onPreset={v => patch({ duration: v })} onCustom={v => patch({ customMin: v })}
                  locked={locked('scheduled')}
                />
              </div>
              <div className="pl-3">
                <FieldLabel>Category</FieldLabel>
                <CategorySelect value={form.category} onChange={v => patch({ category: v })} locked={locked('scheduled')} />
              </div>
              {!hidden('gcal') && gcalAvailable && (
                <div className="pl-3">
                  <label className={`flex items-center gap-3 min-h-[44px] ${calendarLinked ? 'cursor-default' : 'cursor-pointer'}`}>
                    <input
                      type="checkbox" checked={form.gcal} disabled={locked('scheduled')}
                      onChange={e => patch({ gcal: e.target.checked })}
                      className="h-4 w-4 rounded accent-accent-500 disabled:opacity-60"
                    />
                    <span className="text-body text-fg-2">
                      {calendarLinked ? 'Added to Google Calendar' : 'Add to Google Calendar'}
                    </span>
                  </label>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Caller-injected extra fields (Yol 1) */}
      {extra}
    </div>
  )
}
