// ─────────────────────────────────────────────────────────────────────────────
//  End Repeat (migration 193), under Repeat on the item screen: Never, On a day
//  (the last day it may happen, included) or After N times (1–999, counted as
//  the database counts it — recurrence.countEndDay), picked in the shared field
//  list (FieldSelect), an end's value in the same row (the last day's pill, the
//  times' − and +); under it the next dates and the last one (Repeat's own
//  panel then leaves them out: said once), or why the end
//  can't be saved (planForm.repeatEndIssue — the save refuses the same).
// ─────────────────────────────────────────────────────────────────────────────

import { useState, type ReactNode } from 'react'
import { Minus, Plus } from 'lucide-react'
import { IconButton, MetaLine } from '../../ui'
import { DateCalendar } from '../DateCalendar'
import { formatDate } from '../../utils/dateFormat'
import { MAX_REPEAT_COUNT } from '../../../features/daily/recurrence'
import { repeatEndLabel } from '../../../features/items/itemCalendarFields'
import type { RepeatEnd } from '../../../features/items/itemTypes'
import { NoteRow, Panel, Pill, SelectRow } from './ItemRows'
import { endRepeatDefaults } from './itemScreenRules'
import { displayDate, repeatPreview, repeatRowFromForm, repeatStart, type RepeatFormFields } from './planModal.config'
import type { PanelKey } from './TimeSection'
import { typingHints } from './fieldStyles'

type EndKind = 'never' | 'until' | 'count'
const END_KINDS: { value: EndKind; label: string; hint?: string }[] = [
  { value: 'never', label: 'Never' },
  { value: 'until', label: 'On a day', hint: 'The last day it happens' },
  { value: 'count', label: 'After a number of times' },
]

/**
 * End Repeat, one row: its kind in the shared field list (Never / On a day / After a number of times, as Apple's), and
 * an end's value beside it in the same row — the last day as a date pill (a month opens under the row), or the times
 * with − and +. Under it, an end's next dates and its last one, or why it can't be saved.
 */
export function EndRepeatRows({ form, end, start, today, exceptDates, problem, onChange, mark, open, toggle }: {
  form: RepeatFormFields
  end: RepeatEnd | null
  /** The day the repeat counts from (the screen's day; repeatStart moves it to the rule's first real day). */
  start: string
  today: string
  exceptDates?: readonly string[]
  /** Why this end can't be saved (planForm.repeatEndIssue), or null. */
  problem: string | null
  onChange: (end: RepeatEnd | null) => void
  mark?: ReactNode
  open: PanelKey | null
  toggle: (k: PanelKey | null) => void
}) {
  const until = end && 'until' in end ? end.until : null
  const count = end && 'count' in end ? end.count : null
  const row = repeatRowFromForm(form)
  const from = repeatStart(row, start)
  // The tenth time from today (a saved repeat's past is never cut off by a default); the two choices agree.
  const first = () => endRepeatDefaults({ ...row, effective_from: from, except_dates: exceptDates }, today)
  const kind: EndKind = until !== null ? 'until' : count !== null ? 'count' : 'never'
  const preview = end ? repeatPreview(form, start, today, exceptDates, end) : null
  const pick = (k: EndKind) => {
    if (k === kind) return
    if (k === 'never') { onChange(null); toggle(null); return }
    if (k === 'until') { onChange({ until: first().until }); toggle('repeatEnd'); return }
    onChange({ count: first().count })
  }
  return (
    <>
      <SelectRow<EndKind> label="End Repeat" mark={mark} value={kind} options={END_KINDS} onChange={pick} tone={problem ? 'danger' : undefined}
        // An end's value is in the row (the pill, the count): its kind's words would only say it again.
        shown={kind === 'never' ? undefined : null} spoken={repeatEndLabel(end)}
        after={until !== null ? (
          <Pill wide label={`Last day ${formatDate(until)} — change it`} open={open === 'repeatEnd'} onClick={() => toggle('repeatEnd')} bad={!!problem}>
            {displayDate(until)}
          </Pill>
        ) : count !== null ? <TimesField count={count} onChange={n => onChange({ count: n })} /> : undefined} />
      {until !== null && open === 'repeatEnd' && (
        <Panel label="The last day">
          <div className="flex justify-center">
            <DateCalendar compact value={until} selected={[until]} min={from} onPick={d => { onChange({ until: d }); toggle(null) }} />
          </div>
        </Panel>
      )}
      {problem ? <NoteRow tone="danger">{problem}</NoteRow> : preview && (
        <NoteRow>
          <MetaLine as="span" items={[
            preview.next.length ? `Next ${preview.next.map(d => formatDate(d)).join(', ')}` : 'No date ahead',
            ...(preview.last ? [`Last ${formatDate(preview.last)}`] : []),
          ]} />
        </NoteRow>
      )}
    </>
  )
}

/** "[−] 5 [+] times": typed or stepped; an empty or odd number is held and said (After 1 to 999 times). */
function TimesField({ count, onChange }: { count: number; onChange: (n: number) => void }) {
  const [text, setText] = useState(String(count))
  const set = (n: number) => { setText(String(n)); onChange(n) }
  return (
    <div className="flex shrink-0 items-center gap-1.5 text-body text-fg-2">
      <IconButton bordered label="One time fewer" disabled={count <= 1} onClick={() => set(Math.max(1, count - 1))} className="h-8 w-8"><Minus aria-hidden /></IconButton>
      <input {...typingHints('times', 'none')} type="text" inputMode="numeric" pattern="[0-9]*" maxLength={3} value={text} aria-label="Times"
        onChange={e => { setText(e.target.value); onChange(/^\d{1,3}$/.test(e.target.value) ? Number(e.target.value) : 0) }}
        className="input input-sm w-[3em] px-1 text-center tabular-nums" />
      <IconButton bordered label="One time more" disabled={count >= MAX_REPEAT_COUNT} onClick={() => set(Math.min(MAX_REPEAT_COUNT, count + 1))} className="h-8 w-8"><Plus aria-hidden /></IconButton>
      <span>{count === 1 ? 'time' : 'times'}</span>
    </div>
  )
}
