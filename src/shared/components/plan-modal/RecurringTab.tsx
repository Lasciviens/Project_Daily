// ─────────────────────────────────────────────────────────────────────────────
//  UnifiedPlanModal — RECURRING EDITOR (mode='recurring')
//  Editing an EXISTING schedule_blocks row — a real gap this refactor closes
//  (there was no update path for recurring templates at all before
//  migration 077 + this editor; only create/delete existed). No "Also add
//  to Tasks" (there is no recurring-Task concept in this app). "Add to
//  Google Calendar" puts the plan there as ONE repeating event (147);
//  unticking it removes that event.
// ─────────────────────────────────────────────────────────────────────────────

import {
  FieldLabel, Required, TextField, Time24Field, DurationField, CategorySelect, RecurrenceField, DateStepperField, CheckboxRow,
} from './fields'
import {
  shiftTime, stepDate, todayStr, RECURRING_EDIT_OPTIONS, repeatAnchorOf, withStartForRepeatChange, type RepeatAnchor,
} from './planModal.config'
import type { PlanForm } from './planForm'

interface Props {
  form: PlanForm
  patch: (p: Partial<PlanForm>) => void
  /** Creating: the start date is picked here. Editing keeps the saved start
   *  (effective_from — moving it would rewrite the plan's history), except
   *  for a choice that counts from it (Monthly, every N…): "Starts" shows
   *  then, and moves to today when the choice changes what it counts from. */
  creating: boolean
  /** Editing: the saved start and what the saved choice counts from. */
  saved?: { start: string; anchor: RepeatAnchor | null }
  /** The saved plan's left-out days, so the preview skips them too. */
  exceptDates?: readonly string[]
  /** Google is connected: the Calendar option shows. */
  gcalAvailable: boolean
  /** The saved plan is on Google Calendar already. */
  calendarLinked?: boolean
  extra?: React.ReactNode
}

export function RecurringTab({ form, patch, creating, saved, exceptDates, gcalAvailable, calendarLinked, extra }: Props) {
  // A recurring template is never "no repeat" — RECURRING_EDIT_OPTIONS
  // (no 'none' option) makes that unselectable at the UI level. The mode
  // itself should never actually BE 'none' here (buildInitialForm reads it
  // through repeatFormFromRow, which never returns it for a saved row), so
  // no display fallback is needed.
  const pickingDates = form.recurrence === 'custom' && form.customKind === 'dates'
  const showStart = creating ? !pickingDates : repeatAnchorOf(form) !== null
  const onRepeat = (p: Partial<PlanForm>) => patch(saved && !creating ? withStartForRepeatChange(form, p, saved, todayStr()) : p)

  return (
    <div className="flex flex-col gap-4">
      <div>
        <FieldLabel>Title<Required /></FieldLabel>
        <TextField value={form.title} onChange={v => patch({ title: v })} placeholder="What repeats?" autoFocus />
      </div>

      {showStart && (
        <div>
          <FieldLabel>Starts</FieldLabel>
          <DateStepperField value={form.date} onChange={v => patch({ date: v })} onStep={dir => patch({ date: stepDate(form.date, dir) })} />
        </div>
      )}

      <div>
        <FieldLabel>Repeat</FieldLabel>
        <RecurrenceField value={form} onChange={onRepeat} start={form.date} exceptDates={exceptDates} options={RECURRING_EDIT_OPTIONS} />
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

      {gcalAvailable && (
        <CheckboxRow
          checked={form.gcal} onChange={v => patch({ gcal: v })}
          label={calendarLinked ? 'Added to Google Calendar' : 'Add to Google Calendar'}
        />
      )}
    </div>
  )
}
