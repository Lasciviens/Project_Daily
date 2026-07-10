// ─────────────────────────────────────────────────────────────────────────────
//  UnifiedPlanModal — SCHEDULE TAB
//  Time block (+ optional recurring schedule block, task, GCal). Pure view:
//  reads `form`, writes via `patch`. Field visibility comes from `config`.
// ─────────────────────────────────────────────────────────────────────────────

import {
  FieldLabel, TextField, DateStepperField, Time24Field, DurationField,
  CategorySelect, RecurrenceField, CheckboxRow,
} from './fields'
import { stepDate, shiftTime, isScheduleFieldHidden, isScheduleFieldLocked } from './planModal.config'
import type { PlanModalConfig } from './planModal.types'
import type { PlanForm } from './planForm'

interface Props {
  form: PlanForm
  patch: (p: Partial<PlanForm>) => void
  config?: PlanModalConfig
  gcalAvailable: boolean
  extra?: React.ReactNode
  /** True when editing an existing block that already has a linked task —
   *  the checkbox becomes a truthful status readout instead of a live
   *  toggle, since this save path (updating a plain block in place) doesn't
   *  create or remove a task either way. */
  taskAlreadyLinked?: boolean
}

export function ScheduleTab({ form, patch, config, gcalAvailable, extra, taskAlreadyLinked }: Props) {
  const hidden = (f: Parameters<typeof isScheduleFieldHidden>[0]) => isScheduleFieldHidden(f, config)
  const locked = (f: Parameters<typeof isScheduleFieldLocked>[0]) => isScheduleFieldLocked(f, config)

  function toggleDay(day: number) {
    const next = form.weeklyDays.includes(day)
      ? form.weeklyDays.filter(d => d !== day)
      : [...form.weeklyDays, day].sort()
    patch({ weeklyDays: next })
  }

  return (
    <div className="px-5 py-4 flex flex-col gap-4">
      {!hidden('title') && (
        <div>
          <FieldLabel>Title <span className="text-red-400">*</span></FieldLabel>
          <TextField
            value={form.title} onChange={v => patch({ title: v })}
            placeholder="What are you planning?" locked={locked('title')} autoFocus
          />
        </div>
      )}

      {!hidden('date') && (
        <div>
          <FieldLabel>Date</FieldLabel>
          <DateStepperField
            value={form.date} onChange={v => patch({ date: v })}
            onStep={dir => patch({ date: stepDate(form.date, dir) })} locked={locked('date')}
          />
        </div>
      )}

      {!hidden('time') && (
        <div>
          <FieldLabel>Start time (24h)</FieldLabel>
          <Time24Field
            value={form.startTime} onChange={v => patch({ startTime: v })}
            onShift={delta => patch({ startTime: shiftTime(form.startTime, delta) })} locked={locked('time')}
          />
        </div>
      )}

      {!hidden('duration') && (
        <div>
          <FieldLabel>Duration</FieldLabel>
          <DurationField
            duration={form.duration} customMin={form.customMin}
            onPreset={v => patch({ duration: v })} onCustom={v => patch({ customMin: v })}
            locked={locked('duration')}
          />
        </div>
      )}

      {!hidden('category') && (
        <div>
          <FieldLabel>Category</FieldLabel>
          <CategorySelect value={form.category} onChange={v => patch({ category: v })} locked={locked('category')} />
        </div>
      )}

      {!hidden('recurrence') && (
        <div>
          <FieldLabel>Repeat</FieldLabel>
          <RecurrenceField
            mode={form.recurrence} weeklyDays={form.weeklyDays}
            onMode={m => patch({ recurrence: m })} onToggleDay={toggleDay} locked={locked('recurrence')}
          />
        </div>
      )}

      {/* Caller-injected extra fields (Yol 1) */}
      {extra}

      <div className="flex flex-col gap-2">
        {!hidden('alsoCreateTask') && (
          <CheckboxRow
            checked={form.alsoCreateTask} onChange={v => patch({ alsoCreateTask: v })}
            label={taskAlreadyLinked ? 'Also added to To-Do ✓' : 'Also add to To-Do'}
            disabled={taskAlreadyLinked}
            title={taskAlreadyLinked ? 'A To-Do already exists for this plan' : undefined}
          />
        )}
        {!hidden('gcal') && gcalAvailable && (
          <CheckboxRow checked={form.gcal} onChange={v => patch({ gcal: v })} label="Add to Google Calendar" />
        )}
      </div>
    </div>
  )
}
