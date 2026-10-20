// ─────────────────────────────────────────────────────────────────────────────
//  UnifiedPlanModal — THE ONE FORM (one item, migration 155)
//  Replaces the Task / Schedule / Recurring editors (owner, 15.10.2026: one
//  thing to add, the same sheet edits). Pure view: reads `form`, writes via
//  `patch`; the title's quick add runs in UnifiedPlanModal.
//
//    Title (quick add: "Gym 17:30 1h every Mon Wed Fri" + the Read as line)
//    [Thu 15.10.2026] [17:30–18:30] [Blocks 1h] [Repeat] [Google Calendar · busy ▾]
//    [Weekly ▾] M T W T F S S                                  ← once repeating
//    ● Medium priority · Personal · + Notes · + Deadline · + Google list
//    Notes     [ … ]                                           ← rows opened
//    Deadline  [ … ]
//
//  A repeating item opened on one of its days gets This day | All days in the
//  sheet's header (UnifiedPlanModal).
// ─────────────────────────────────────────────────────────────────────────────

import { useId, useLayoutEffect, useRef } from 'react'
import { Plus, Repeat, X } from 'lucide-react'
import { RecurrenceField, Time24Field } from './fields'
import { chipClass } from './fieldStyles'
import { DateChip } from './DateChip'
import { TimeChip, LengthChip } from './TimeChips'
import { GoogleChip } from './GoogleChip'
import { GoogleListField } from './GoogleListField'
import { TaskWindowField } from './TaskWindowField'
import { AddFact, AreaFact, CategoryFact, FactRow, PriorityFact } from './ItemFacts'
import { DateInput } from '../DateInput'
import { cx } from '../../ui'
import { ReadAsLine } from '../../../features/items/components/ReadAsLine'
import { effectiveGoogleTarget, hasGoogleCalendar, hasGoogleTasks } from '../../../features/items/sheetRules'
import { weekdayOfIso } from '../../../features/daily/recurrence'
import {
  isScheduleFieldHidden, isTaskFieldHidden, pickRecurrence, repeatAnchorOf, shiftTime, withStartForRepeatChange,
  RECURRENCE_OPTIONS, RECURRING_EDIT_OPTIONS, type RepeatAnchor,
} from './planModal.config'
import { shapeOf, withAllDay, withDate, withTime, type PlanForm, type SheetRow } from './planForm'
import type { PlanModalConfig } from './planModal.types'
import type { QuickAddResult } from '../../../features/items/quickAdd'

const ROW_LABEL: Record<SheetRow, string> = { notes: 'Notes', priority: 'Priority', deadline: 'Deadline', area: 'Area', list: 'Google list' }
/** Priority and area always hold a value: they read as values on the facts line, never as rows. */
const VALUE_FACTS: readonly SheetRow[] = ['priority', 'area']

interface Props {
  form: PlanForm
  patch: (p: Partial<PlanForm>) => void
  config?: PlanModalConfig
  /** The title field's text (with quick add it may say more than the saved title). */
  typed: string
  onTitle: (text: string) => void
  /** What quick add read from `typed`, while it reads anything. */
  parse: QuickAddResult | null
  onKeepText: () => void
  creating: boolean
  today: string
  nextTime: string
  googleConnected: boolean
  /** A repeating item opened on one of its days (its This day | All days is in the header). */
  occurrenceDate?: string | null
  /** Editing: a saved one-off doesn't turn into a repeat here, nor a saved repeat into a one-off. */
  savedKind?: 'one-off' | 'repeat'
  /** Editing a repeat: its saved start and what it counts from. */
  savedRepeat?: { start: string; anchor: RepeatAnchor | null }
  exceptDates?: readonly string[]
}

export function ItemForm({
  form, patch, config, typed, onTitle, parse, onKeepText, creating, today, nextTime, googleConnected,
  occurrenceDate, savedKind, savedRepeat, exceptDates,
}: Props) {
  const titleId = useId()
  const notesId = useId()
  const hideTask = (f: Parameters<typeof isTaskFieldHidden>[0]) => isTaskFieldHidden(f, config)
  const day = !!occurrenceDate && form.scope === 'day'
  const repeating = form.recurrence !== 'none' && !day
  const pickingDates = repeating && form.recurrence === 'custom' && form.customKind === 'dates'
  // A saved repeat shows its start only for a choice that counts from it (Monthly, every N).
  const showDate = !pickingDates && (savedKind !== 'repeat' || day || repeatAnchorOf(form) !== null)
  const canAddRepeat = !repeating && !day && savedKind !== 'one-off' && !isScheduleFieldHidden('recurrence', config)
  const shape = shapeOf(form)
  const target = effectiveGoogleTarget(shape, form.googlePick)
  const showGoogle = googleConnected && !day && !isScheduleFieldHidden('gcal', config)
  const allDay = showGoogle && !form.time && hasGoogleCalendar(target)

  const rows: SheetRow[] = (['notes', 'priority', 'deadline', 'area', 'list'] as const).filter(r => {
    if (r === 'notes') return !hideTask('notes')
    if (r === 'priority') return !hideTask('priority')
    if (r === 'deadline') return !(hideTask('dueDate') && hideTask('startDate'))
    if (r === 'area') return !hideTask('domain')
    // A repeat's days go to the default list (156 stores no list per repeat).
    return showGoogle && hasGoogleTasks(target) && !repeating && !hideTask('googleList')
  })
  // A category belongs to a slot or a repeat: only an item with a time or a repeat has one.
  const showCategory = (!!form.time || repeating) && !isScheduleFieldHidden('category', config)
  const open = (r: SheetRow) => form.shown.includes(r) && rows.includes(r)
  const addable = rows.filter(r => !VALUE_FACTS.includes(r) && !open(r))

  const startRepeat = () => {
    const date = form.date ?? today
    patch({ date, ...pickRecurrence(form, 'weekly', weekdayOfIso(date)) })
  }
  const onRepeat = (p: Partial<PlanForm>) =>
    patch(savedRepeat && savedKind === 'repeat' ? withStartForRepeatChange(form, p, savedRepeat, today) : p)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor={titleId} className="sr-only">Title</label>
        <TitleField id={titleId} value={typed} onChange={onTitle} autoFocus={creating}
          placeholder={creating ? 'e.g. Gym 17:30 1h every Mon Wed Fri' : 'Title'} />
        {parse && <ReadAsLine parse={parse} start={form.date ?? today} onKeepText={onKeepText} />}
      </div>

      {/* One quiet row: date · time · length · repeat · Google — it wraps only when it must. */}
      <div className="flex flex-wrap items-center gap-1.5">
        {showDate && (
          <DateChip
            value={form.date} onChange={date => patch(withDate(date))} today={today}
            allowNone={!repeating && !day} prefix={repeating ? 'Starts' : undefined}
          />
        )}
        {(form.date || repeating) && (
          <TimeChip
            time={form.time} duration={form.duration} nextTime={nextTime}
            // "No time" on an all-day item takes All day off too: Google goes back to its default (Tasks).
            onChange={t => patch(t ? withTime(t) : { ...withTime(null), ...(allDay ? { googlePick: null } : {}) })}
            allDay={allDay}
            onAllDay={showGoogle ? () => patch(withAllDay(form)) : undefined}
          />
        )}
        {form.time && <LengthChip duration={form.duration} onChange={duration => patch({ duration })} />}
        {canAddRepeat && (
          <button type="button" onClick={startRepeat} className={chipClass('add')}>
            <Repeat aria-hidden />Repeat
          </button>
        )}
        {showGoogle && <GoogleChip shape={shape} target={target} onPick={googlePick => patch({ googlePick })} />}
      </div>

      {repeating && (
        <RecurrenceField
          value={form} onChange={onRepeat} start={form.date ?? today} exceptDates={exceptDates}
          options={savedKind === 'repeat' ? RECURRING_EDIT_OPTIONS : RECURRENCE_OPTIONS}
        />
      )}

      {(rows.some(r => VALUE_FACTS.includes(r)) || showCategory || addable.length > 0) && (
        <div className="-ml-1.5 flex flex-wrap items-center gap-x-0.5 gap-y-1">
          {rows.includes('priority') && <PriorityFact value={form.priority} onChange={priority => patch({ priority })} />}
          {rows.includes('area') && <AreaFact value={form.domain} onChange={domain => patch({ domain })} />}
          {showCategory && <CategoryFact value={form.category} onChange={category => patch({ category })} />}
          {addable.map(r => <AddFact key={r} label={ROW_LABEL[r]} onClick={() => patch({ shown: [...form.shown, r] })} />)}
        </div>
      )}

      {open('notes') && (
        <FactRow label="Notes" htmlFor={notesId}>
          <textarea
            id={notesId} value={form.notes} rows={2} onChange={e => patch({ notes: e.target.value })}
            placeholder="Add details" className="input input-sm block resize-none"
          />
        </FactRow>
      )}
      {open('deadline') && <DeadlineRow form={form} patch={patch} config={config} />}
      {open('list') && <GoogleListField value={form.googleListTitle} onChange={googleListTitle => patch({ googleListTitle })} />}
    </div>
  )
}

/** One line that grows with a long title (a long task name used to run out of a one-line field). Enter adds no line break. */
function TitleField({ id, value, onChange, autoFocus, placeholder }: {
  id: string
  value: string
  onChange: (text: string) => void
  autoFocus: boolean
  placeholder: string
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    // + the border (an underline), which scrollHeight leaves out.
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`
  }, [value])
  return (
    <textarea
      ref={ref} id={id} rows={1} value={value} autoFocus={autoFocus} placeholder={placeholder}
      onChange={e => onChange(e.target.value.replace(/\s*\n+\s*/g, ' '))}
      onKeyDown={e => { if (e.key === 'Enter') e.preventDefault() }}
      autoComplete="off" enterKeyHint="done"
      className="input-bare resize-none overflow-hidden text-title font-semibold placeholder:font-normal"
    />
  )
}

/** "+ Deadline": due by a date (and a time), and the "do it between" window that closes on it. */
function DeadlineRow({ form, patch, config }: Pick<Props, 'form' | 'patch' | 'config'>) {
  const showDue = !isTaskFieldHidden('dueDate', config)
  const showTime = showDue && !isTaskFieldHidden('dueTime', config)
  if (!showDue) return null
  return (
    <FactRow label="Deadline">
      <div className="flex flex-col gap-1.5">
        <div className={cx('flex flex-wrap items-center gap-1.5', form.deadlineTime && 'flex-col items-stretch')}>
          <DateInput
            value={form.deadlineDate} onChange={deadlineDate => patch({ deadlineDate, ...(deadlineDate ? {} : { deadlineTime: '' }) })}
            aria-label="Deadline date" className="input input-sm w-[8.5rem] tabular-nums"
          />
          {showTime && form.deadlineDate && (form.deadlineTime ? (
            <div className="flex items-center gap-1">
              <div className="min-w-0 flex-1">
                <Time24Field
                  size="sm" value={form.deadlineTime} onChange={deadlineTime => patch({ deadlineTime })}
                  onShift={delta => patch({ deadlineTime: shiftTime(form.deadlineTime, delta) })}
                />
              </div>
              <button type="button" onClick={() => patch({ deadlineTime: '' })} aria-label="No deadline time" className={chipClass('remove')}>
                <X aria-hidden />
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => patch({ deadlineTime: '17:00' })} className={chipClass('quiet')}>
              <Plus aria-hidden />Time
            </button>
          ))}
        </div>
        {!isTaskFieldHidden('startDate', config) && (
          <TaskWindowField
            startDate={form.startDate} dueDate={form.deadlineDate}
            onChange={v => patch({ startDate: v.startDate, deadlineDate: v.dueDate })}
          />
        )}
      </div>
    </FactRow>
  )
}
