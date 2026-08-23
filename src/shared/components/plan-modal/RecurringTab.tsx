// ─────────────────────────────────────────────────────────────────────────────
//  UnifiedPlanModal — RECURRING EDITOR (mode='recurring')
//  Editing an EXISTING schedule_blocks row — a real gap this refactor closes
//  (there was no update path for recurring templates at all before
//  migration 077 + this editor; only create/delete existed). No "Also add
//  to Tasks" (there is no recurring-Task concept in this app) and no Google
//  Calendar control (never implemented for recurring — a checkbox that
//  silently does nothing would be worse than no control at all).
// ─────────────────────────────────────────────────────────────────────────────

import { FieldLabel, TextField, Time24Field, DurationField, CategorySelect, RecurrenceField } from './fields'
import { shiftTime, RECURRING_EDIT_OPTIONS, hasValidRecurrenceSelection } from './planModal.config'
import type { PlanForm } from './planForm'

interface Props {
  form: PlanForm
  patch: (p: Partial<PlanForm>) => void
  extra?: React.ReactNode
}

export function RecurringTab({ form, patch, extra }: Props) {
  function toggleDay(day: number) {
    const next = form.weeklyDays.includes(day)
      ? form.weeklyDays.filter(d => d !== day)
      : [...form.weeklyDays, day].sort()
    patch({ weeklyDays: next })
  }

  // A recurring template is never "no repeat" — RECURRING_EDIT_OPTIONS
  // (no 'none' pill) makes that unselectable at the UI level. The mode
  // itself should never actually BE 'none' here (buildInitialForm infers
  // it via inferRecurrenceMode, which only ever returns daily/weekdays/
  // weekly for an existing scheduleBlock), so no display fallback is
  // needed — unlike before, when 'none' silently displayed as 'weekly'
  // while saveRecurring quietly converted the real value behind it.
  const showZeroDaysWarning = form.recurrence === 'weekly' && !hasValidRecurrenceSelection('weekly', form.weeklyDays)

  return (
    <div className="px-5 py-4 flex flex-col gap-4">
      <div>
        <FieldLabel>Title <span className="text-red-400">*</span></FieldLabel>
        <TextField value={form.title} onChange={v => patch({ title: v })} placeholder="What repeats?" autoFocus />
      </div>

      <div>
        <FieldLabel>Repeat</FieldLabel>
        <RecurrenceField
          mode={form.recurrence}
          weeklyDays={form.weeklyDays}
          onMode={m => patch({ recurrence: m })}
          onToggleDay={toggleDay}
          options={RECURRING_EDIT_OPTIONS}
        />
        {showZeroDaysWarning && (
          <p className="mt-1.5 text-[11px] text-red-500">Pick at least one day.</p>
        )}
      </div>

      <div>
        <FieldLabel>Start time (24h)</FieldLabel>
        <Time24Field
          value={form.startTime} onChange={v => patch({ startTime: v })}
          onShift={delta => patch({ startTime: shiftTime(form.startTime, delta) })}
        />
      </div>

      <div>
        <FieldLabel>Duration</FieldLabel>
        <DurationField
          duration={form.duration} customMin={form.customMin}
          onPreset={v => patch({ duration: v })} onCustom={v => patch({ customMin: v })}
        />
        <p className="mt-1.5 text-[11px] text-ink-400">Crossing midnight is fine — end time wraps to the next day.</p>
      </div>

      <div>
        <FieldLabel>Category</FieldLabel>
        <CategorySelect value={form.category} onChange={v => patch({ category: v })} />
      </div>

      {extra}
    </div>
  )
}
