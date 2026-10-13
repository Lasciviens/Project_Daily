// ─────────────────────────────────────────────────────────────────────────────
//  UnifiedPlanModal — RECURRING EDITOR (mode='recurring')
//  Editing an EXISTING schedule_blocks row — a real gap this refactor closes
//  (there was no update path for recurring templates at all before
//  migration 077 + this editor; only create/delete existed). No "Also add
//  to Tasks" (there is no recurring-Task concept in this app) and no Google
//  Calendar control (never implemented for recurring — a checkbox that
//  silently does nothing would be worse than no control at all).
// ─────────────────────────────────────────────────────────────────────────────

import { FieldLabel, Required, TextField, Time24Field, DurationField, CategorySelect, RecurrenceField, DateStepperField } from './fields'
import { shiftTime, stepDate, RECURRING_EDIT_OPTIONS } from './planModal.config'
import type { PlanForm } from './planForm'

interface Props {
  form: PlanForm
  patch: (p: Partial<PlanForm>) => void
  /** Creating: the start date is picked here. Editing keeps the saved start
   *  (effective_from — moving it would rewrite the plan's history). */
  creating: boolean
  /** The saved plan's left-out days, so the preview skips them too. */
  exceptDates?: readonly string[]
  extra?: React.ReactNode
}

export function RecurringTab({ form, patch, creating, exceptDates, extra }: Props) {
  // A recurring template is never "no repeat" — RECURRING_EDIT_OPTIONS
  // (no 'none' option) makes that unselectable at the UI level. The mode
  // itself should never actually BE 'none' here (buildInitialForm reads it
  // through repeatFormFromRow, which never returns it for a saved row), so
  // no display fallback is needed.
  const pickingDates = form.recurrence === 'custom' && form.customKind === 'dates'

  return (
    <div className="flex flex-col gap-4">
      <div>
        <FieldLabel>Title<Required /></FieldLabel>
        <TextField value={form.title} onChange={v => patch({ title: v })} placeholder="What repeats?" autoFocus />
      </div>

      {creating && !pickingDates && (
        <div>
          <FieldLabel>Starts</FieldLabel>
          <DateStepperField value={form.date} onChange={v => patch({ date: v })} onStep={dir => patch({ date: stepDate(form.date, dir) })} />
        </div>
      )}

      <div>
        <FieldLabel>Repeat</FieldLabel>
        <RecurrenceField value={form} onChange={patch} start={form.date} exceptDates={exceptDates} options={RECURRING_EDIT_OPTIONS} />
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
        <p className="mt-1.5 text-meta text-fg-muted">Crossing midnight is fine — end time wraps to the next day.</p>
      </div>

      <div>
        <FieldLabel>Category</FieldLabel>
        <CategorySelect value={form.category} onChange={v => patch({ category: v })} />
      </div>

      {extra}
    </div>
  )
}
