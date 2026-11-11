// ─────────────────────────────────────────────────────────────────────────────
//  End Repeat (migration 193), under Repeat on the item screen: Never, On a day
//  (the last day it may happen, included) or After N times (1–999, counted as
//  the database counts it — recurrence.countEndDay). Opened, it lists the next
//  dates as they will be, the last one too, or why the end can't be saved
//  (planForm.repeatEndIssue — the save refuses the same).
// ─────────────────────────────────────────────────────────────────────────────

import { useState, type ReactNode } from 'react'
import { Minus, Plus } from 'lucide-react'
import { IconButton, MetaLine } from '../../ui'
import { DateCalendar } from '../DateCalendar'
import { formatDate } from '../../utils/dateFormat'
import { addDaysIso, countEndDay, MAX_REPEAT_COUNT } from '../../../features/daily/recurrence'
import { repeatEndLabel } from '../../../features/items/itemCalendarFields'
import type { RepeatEnd } from '../../../features/items/itemTypes'
import { ChoiceRow, Panel, TapRow } from './ItemRows'
import { repeatPreview, repeatRowFromForm, repeatStart, type RepeatFormFields } from './planModal.config'
import type { PanelKey } from './TimeSection'

/** "After N times" starts at ten; "On a day" at the tenth time's day — the two choices agree when switched. */
const FIRST_COUNT = 10

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
  const firstUntil = () => countEndDay({ ...row, effective_from: from, repeat_count: FIRST_COUNT }) ?? addDaysIso(from, 30)
  const preview = repeatPreview(form, start, today, exceptDates, end)
  return (
    <>
      <TapRow label="End Repeat" mark={mark} value={repeatEndLabel(end)} open={open === 'repeatEnd'} onClick={() => toggle('repeatEnd')}
        tone={problem ? 'danger' : undefined} />
      {open === 'repeatEnd' && (
        <Panel label="End Repeat">
          <ChoiceRow label="Never" chosen={!end} onClick={() => { onChange(null); toggle(null) }} />
          <ChoiceRow label="On a day" hint="The last day it happens" chosen={until !== null} onClick={() => onChange({ until: until ?? firstUntil() })} />
          {until !== null && (
            <div className="flex justify-center pb-1">
              <DateCalendar compact value={until} selected={[until]} min={from} onPick={d => onChange({ until: d })} />
            </div>
          )}
          <ChoiceRow label="After a number of times" chosen={count !== null} onClick={() => onChange({ count: count ?? FIRST_COUNT })} />
          {count !== null && <TimesField count={count} onChange={n => onChange({ count: n })} />}
          {problem ? (
            <p className="pt-1.5 text-meta text-danger">{problem}</p>
          ) : preview && (
            <MetaLine className="pt-1.5 text-meta text-fg-muted" items={[
              preview.next.length ? `Next ${preview.next.map(d => formatDate(d)).join(', ')}` : 'No date ahead',
              ...(preview.last ? [`Last ${formatDate(preview.last)}`] : []),
            ]} />
          )}
        </Panel>
      )}
    </>
  )
}

/** "After [−] 5 [+] times": typed or stepped; an empty or odd number is held and said (After 1 to 999 times). */
function TimesField({ count, onChange }: { count: number; onChange: (n: number) => void }) {
  const [text, setText] = useState(String(count))
  const set = (n: number) => { setText(String(n)); onChange(n) }
  return (
    <div className="flex items-center gap-2 pb-1 text-body text-fg-2">
      <span>After</span>
      <IconButton bordered label="One time fewer" disabled={count <= 1} onClick={() => set(Math.max(1, count - 1))}><Minus aria-hidden /></IconButton>
      <input type="number" inputMode="numeric" min={1} max={MAX_REPEAT_COUNT} value={text} aria-label="Times"
        onChange={e => { setText(e.target.value); const n = Number(e.target.value); onChange(Number.isInteger(n) ? n : 0) }}
        className="input input-sm w-16 text-center tabular-nums" />
      <IconButton bordered label="One time more" disabled={count >= MAX_REPEAT_COUNT} onClick={() => set(Math.min(MAX_REPEAT_COUNT, count + 1))}><Plus aria-hidden /></IconButton>
      <span>{count === 1 ? 'time' : 'times'}</span>
    </div>
  )
}
