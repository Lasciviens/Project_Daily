// ─────────────────────────────────────────────────────────────────────────────
//  UnifiedPlanModal — TASK WINDOW FIELD
//  "Do it between A and B": start_date opens the window, due_date stays the one
//  and only deadline representation (overdue, the brief, the push, the phone and
//  workMeta.ts all keep reading due_date and need no new concept).
//
//  A season chip sets BOTH ends in one tap — the whole point, since DateInput has
//  no calendar popup and a typed range costs 16 digit taps. The manual path is a
//  single "From" box: the closing end is the Due Date field already on screen, so
//  a second date box would render the same value twice.
//
//  The season math (leap-safe end of February, "this winter" from July = the
//  UPCOMING 1 Dec) is imported from shared/components/windowChips, not re-derived.
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from 'react'
import { FieldLabel } from './fields'
import { DateInput } from '../DateInput'
import { seasonWindows, windowRangeLabel } from '../windowChips'
import { todayStr } from './planModal.config'

const CHIP_BASE = 'px-3 min-h-[44px] rounded-xl border text-sm font-medium transition-colors disabled:opacity-40'
const CHIP_ON   = 'bg-accent-500 text-white border-accent-500'
const CHIP_OFF  = 'border-ink-200 text-ink-600 hover:bg-cream-100'

interface Props {
  startDate: string
  dueDate:   string
  onChange:  (v: { startDate: string; dueDate: string }) => void
  locked?:   boolean
}

export function TaskWindowField({ startDate, dueDate, onChange, locked }: Props) {
  const [open, setOpen] = useState(false)
  const windows = seasonWindows(todayStr())
  const matched = windows.find(w => w.start === startDate && w.end === dueDate)
  const expanded = open || !!startDate

  if (!expanded) {
    return (
      <div>
        <FieldLabel>Window (optional)</FieldLabel>
        <button
          type="button" onClick={() => setOpen(true)} disabled={locked}
          className="w-full min-h-[44px] bg-cream-50 border border-dashed border-ink-200 rounded-xl text-sm text-ink-400 hover:text-accent-600 hover:border-accent-300 transition-colors disabled:opacity-40"
        >
          + Do it between two dates
        </button>
      </div>
    )
  }

  return (
    <div>
      <FieldLabel>Window — do it between</FieldLabel>
      <div className="flex flex-wrap gap-2">
        {windows.map(w => (
          <button
            key={w.label} type="button" disabled={locked}
            onClick={() => onChange({ startDate: w.start, dueDate: w.end })}
            className={`${CHIP_BASE} ${matched?.label === w.label ? CHIP_ON : CHIP_OFF}`}
          >{w.label}</button>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="text-xs font-medium text-ink-500">
          Start from
          <DateInput
            value={startDate}
            onChange={v => onChange({ startDate: v, dueDate })}
            aria-label="Start date"
            className="mt-1 block min-h-[44px] w-full max-w-[9rem] rounded-xl border border-ink-200 bg-cream-50 px-3 text-sm text-ink-900 focus:outline-none focus:ring-2 focus:ring-accent-400"
          />
        </label>
        <button
          type="button" disabled={locked}
          onClick={() => { setOpen(false); onChange({ startDate: '', dueDate }) }}
          className={`${CHIP_BASE} ${CHIP_OFF}`}
        >✕ No window</button>
      </div>

      <p className="mt-2 text-xs text-ink-500">
        {startDate && dueDate
          ? `Open ${windowRangeLabel(startDate, dueDate)} — the due date stays the deadline.`
          : 'Pick the earliest day you can start. The Due Date above stays the deadline.'}
      </p>
    </div>
  )
}
