// ─────────────────────────────────────────────────────────────────────────────
//  UnifiedPlanModal — SCHEDULE EDITOR (mode='schedule')
//  A plain one-off time_block with NO linked task — a task-linked block is
//  always edited via mode='task' instead (see planModal.types.ts's
//  UnifiedPlanModalProps.timeBlock comment), so "Also add to Tasks" here is
//  now unambiguous: checking it always means "create one and link it",
//  never a readout of an existing link. Pure view: reads `form`, writes via
//  `patch`. Field visibility comes from `config`.
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
}

export function ScheduleTab({ form, patch, config, gcalAvailable, extra }: Props) {
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

      {/* CREATE only — UnifiedPlanModal hides this field via config when
          editing an existing one-off block. Converting an existing one-off
          record to recurring (or vice versa) is a real, separate storage-
          migration UX this refactor deliberately does not build. */}
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
            label="Also add to Tasks"
          />
        )}
        {!hidden('gcal') && gcalAvailable && (
          <CheckboxRow checked={form.gcal} onChange={v => patch({ gcal: v })} label="Add to Google Calendar" />
        )}
      </div>
    </div>
  )
}
