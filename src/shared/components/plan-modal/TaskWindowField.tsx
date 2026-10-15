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
import { Plus, X } from 'lucide-react'
import { choiceClass, chipClass } from './fieldStyles'
import { DateInput } from '../DateInput'
import { seasonWindows, windowRangeLabel } from '../windowChips'
import { todayStr } from './planModal.config'

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
      <button type="button" onClick={() => setOpen(true)} disabled={locked} className={chipClass('quiet', '-ml-1.5 self-start')}>
        <Plus aria-hidden />Do it between two dates
      </button>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-meta text-fg-muted">Window — do it between</p>
        <button
          type="button" disabled={locked}
          onClick={() => { setOpen(false); onChange({ startDate: '', dueDate }) }}
          className={chipClass('remove', '-mr-1.5')}
        ><X aria-hidden />No window</button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {windows.map(w => (
          <button
            key={w.label} type="button" disabled={locked}
            onClick={() => onChange({ startDate: w.start, dueDate: w.end })}
            aria-pressed={matched?.label === w.label}
            className={choiceClass(matched?.label === w.label, undefined, 'sm')}
          >{w.label}</button>
        ))}
      </div>

      <label className="flex items-center gap-1.5 text-meta text-fg-muted">
        Start from
        <DateInput
          value={startDate}
          onChange={v => onChange({ startDate: v, dueDate })}
          aria-label="Start date"
          className="input input-sm w-[8.5rem] tabular-nums"
        />
      </label>

      <p className="text-meta text-fg-muted">
        {startDate && dueDate
          ? `Open ${windowRangeLabel(startDate, dueDate)} — the due date stays the deadline.`
          : 'Pick the earliest day you can start. The due date above stays the deadline.'}
      </p>
    </div>
  )
}
