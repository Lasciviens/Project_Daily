// ─────────────────────────────────────────────────────────────────────────────
//  UnifiedPlanModal — THE ONE FORM (one item, migration 155)
//  Replaces the Task / Schedule / Recurring editors (owner, 15.10.2026: one
//  thing to add, the same sheet edits). Pure view: reads `form`, writes via
//  `patch`; the title's quick add runs in UnifiedPlanModal.
//
//    Title (quick add: "Gym 17:30 1h every Mon Wed Fri" + the Read as line)
//    [Thu 15.10.2026] [17:30–18:30] [Blocks 1h] [+ Repeat]     ← when
//    Repeat line (the planner's select + day circles), once repeating
//    [Google Calendar · busy ▾]                                ← Google
//    rows opened below …
//    [+ Notes] [+ Priority] [+ Deadline] [+ Area] [+ Google list]
//
//  A repeating item opened on one of its days gets This day | All days on top.
// ─────────────────────────────────────────────────────────────────────────────

import { useId, useLayoutEffect, useRef } from 'react'
import { Repeat, X } from 'lucide-react'
import { FieldLabel, PillGroup, RecurrenceField, Time24Field } from './fields'
import { chipClass, ADD_SLOT_CLASS } from './fieldStyles'
import { DateChip } from './DateChip'
import { TimeChip, LengthChip } from './TimeChips'
import { GoogleChip } from './GoogleChip'
import { GoogleListField } from './GoogleListField'
import { TaskWindowField } from './TaskWindowField'
import { DateInput } from '../DateInput'
import { SegmentedControl, cx, type Tone } from '../../ui'
import { ReadAsLine } from '../../../features/items/components/ReadAsLine'
import { effectiveGoogleTarget, hasGoogleTasks } from '../../../features/items/sheetRules'
import { weekdayOfIso } from '../../../features/daily/recurrence'
import { DOMAIN_LABEL } from '../../../features/todo/domainColors'
import { PRIORITY_LABEL, PRIORITY_TONE } from '../../../features/todo/taskTones'
import {
  isScheduleFieldHidden, isTaskFieldHidden, pickRecurrence, repeatAnchorOf, shiftTime, withStartForRepeatChange,
  RECURRENCE_OPTIONS, RECURRING_EDIT_OPTIONS, type RepeatAnchor,
} from './planModal.config'
import { shapeOf, withDate, withTime, type PlanForm, type SheetRow } from './planForm'
import type { PlanModalConfig } from './planModal.types'
import type { QuickAddResult } from '../../../features/items/quickAdd'
import type { TaskDomain, TaskPriority } from '../../../features/todo/types'

const PRIORITIES: { id: TaskPriority; label: string; tone: Tone }[] = (['low', 'medium', 'high'] as const)
  .map(id => ({ id, label: PRIORITY_LABEL[id], tone: PRIORITY_TONE[id] }))
const DOMAINS: { id: TaskDomain; label: string }[] = (['personal', 'work', 'media'] as const).map(id => ({ id, label: DOMAIN_LABEL[id] }))

const ROW_LABEL: Record<SheetRow, string> = { notes: 'Notes', priority: 'Priority', deadline: 'Deadline', area: 'Area', list: 'Google list' }
const SCOPES: { value: 'day' | 'all'; label: string }[] = [{ value: 'day', label: 'This day' }, { value: 'all', label: 'All days' }]

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
  /** A repeating item opened on one of its days: This day | All days. */
  occurrenceDate?: string | null
  onScope: (scope: 'day' | 'all') => void
  /** Editing: a saved one-off doesn't turn into a repeat here, nor a saved repeat into a one-off. */
  savedKind?: 'one-off' | 'repeat'
  /** Editing a repeat: its saved start and what it counts from. */
  savedRepeat?: { start: string; anchor: RepeatAnchor | null }
  exceptDates?: readonly string[]
}

export function ItemForm({
  form, patch, config, typed, onTitle, parse, onKeepText, creating, today, nextTime, googleConnected,
  occurrenceDate, onScope, savedKind, savedRepeat, exceptDates,
}: Props) {
  const titleId = useId()
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

  const rows: SheetRow[] = (['notes', 'priority', 'deadline', 'area', 'list'] as const).filter(r => {
    if (r === 'notes') return !hideTask('notes')
    if (r === 'priority') return !hideTask('priority')
    if (r === 'deadline') return !(hideTask('dueDate') && hideTask('startDate'))
    if (r === 'area') return !hideTask('domain')
    return showGoogle && hasGoogleTasks(target) && !hideTask('googleList')
  })
  const open = (r: SheetRow) => form.shown.includes(r) && rows.includes(r)

  const startRepeat = () => {
    const date = form.date ?? today
    patch({ date, ...pickRecurrence(form, 'weekly', weekdayOfIso(date)) })
  }
  const onRepeat = (p: Partial<PlanForm>) =>
    patch(savedRepeat && savedKind === 'repeat' ? withStartForRepeatChange(form, p, savedRepeat, today) : p)

  return (
    <div className="flex flex-col gap-3">
      {occurrenceDate && (
        <SegmentedControl size="sm" options={SCOPES} value={form.scope} onChange={onScope} />
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor={titleId} className="sr-only">Title</label>
        <TitleField id={titleId} value={typed} onChange={onTitle} autoFocus={creating}
          placeholder={creating ? 'e.g. Gym 17:30 1h every Mon Wed Fri' : 'Title'} />
        {parse && <ReadAsLine parse={parse} start={form.date ?? today} onKeepText={onKeepText} />}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {showDate && (
          <DateChip
            value={form.date} onChange={date => patch(withDate(date))} today={today}
            allowNone={!repeating && !day} prefix={repeating ? 'Starts' : undefined}
          />
        )}
        {(form.date || repeating) && (
          <TimeChip time={form.time} duration={form.duration} nextTime={nextTime} onChange={t => patch(withTime(t))} />
        )}
        {form.time && <LengthChip duration={form.duration} onChange={duration => patch({ duration })} />}
        {canAddRepeat && (
          <button type="button" onClick={startRepeat} className={chipClass('add')}>
            <Repeat aria-hidden />Repeat
          </button>
        )}
      </div>

      {repeating && (
        <RecurrenceField
          value={form} onChange={onRepeat} start={form.date ?? today} exceptDates={exceptDates}
          options={savedKind === 'repeat' ? RECURRING_EDIT_OPTIONS : RECURRENCE_OPTIONS}
        />
      )}

      {showGoogle && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <GoogleChip shape={shape} target={target} onPick={googlePick => patch({ googlePick })} />
        </div>
      )}

      {open('notes') && (
        <div>
          <FieldLabel>Notes</FieldLabel>
          <textarea
            value={form.notes} rows={2} onChange={e => patch({ notes: e.target.value })}
            placeholder="Add details" className="input resize-none"
          />
        </div>
      )}
      {open('priority') && (
        <div>
          <FieldLabel>Priority</FieldLabel>
          <PillGroup options={PRIORITIES} value={form.priority} onChange={priority => patch({ priority })} size="sm" />
        </div>
      )}
      {open('deadline') && <DeadlineRow form={form} patch={patch} config={config} />}
      {open('area') && (
        <div>
          <FieldLabel>Area</FieldLabel>
          <PillGroup options={DOMAINS} value={form.domain} onChange={domain => patch({ domain })} size="sm" />
        </div>
      )}
      {open('list') && <GoogleListField value={form.googleListTitle} onChange={googleListTitle => patch({ googleListTitle })} />}

      {rows.some(r => !open(r)) && (
        <div className="flex flex-wrap gap-1.5">
          {rows.filter(r => !open(r)).map(r => (
            <button
              key={r} type="button" onClick={() => patch({ shown: [...form.shown, r] })}
              className={chipClass('add', 'min-h-[30px] px-2.5 text-meta [@media(pointer:coarse)]:min-h-[36px]')}
            >+ {ROW_LABEL[r]}</button>
          ))}
        </div>
      )}
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
    el.style.height = `${el.scrollHeight + 2}px`
  }, [value])
  return (
    <textarea
      ref={ref} id={id} rows={1} value={value} autoFocus={autoFocus} placeholder={placeholder}
      onChange={e => onChange(e.target.value.replace(/\s*\n+\s*/g, ' '))}
      onKeyDown={e => { if (e.key === 'Enter') e.preventDefault() }}
      autoComplete="off" enterKeyHint="done" className="input resize-none overflow-hidden"
    />
  )
}

/** "+ Deadline": due by a date (and a time), and the "do it between" window that closes on it. */
function DeadlineRow({ form, patch, config }: Pick<Props, 'form' | 'patch' | 'config'>) {
  const showDue = !isTaskFieldHidden('dueDate', config)
  const showTime = showDue && !isTaskFieldHidden('dueTime', config)
  return (
    <div className="flex flex-col gap-2">
      {showDue && (
        <div>
          <FieldLabel>Deadline</FieldLabel>
          <div className={cx('flex flex-wrap items-center gap-2', form.deadlineTime && 'flex-col items-stretch')}>
            <DateInput
              value={form.deadlineDate} onChange={deadlineDate => patch({ deadlineDate, ...(deadlineDate ? {} : { deadlineTime: '' }) })}
              aria-label="Deadline date" className="input w-[10rem] tabular-nums"
            />
            {showTime && form.deadlineDate && (form.deadlineTime ? (
              <div className="flex items-center gap-1.5">
                <div className="min-w-0 flex-1">
                  <Time24Field
                    value={form.deadlineTime} onChange={deadlineTime => patch({ deadlineTime })}
                    onShift={delta => patch({ deadlineTime: shiftTime(form.deadlineTime, delta) })}
                  />
                </div>
                <button type="button" onClick={() => patch({ deadlineTime: '' })} aria-label="No deadline time" className="icon-btn text-fg-faint hover:text-danger">
                  <X className="h-4 w-4" aria-hidden />
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => patch({ deadlineTime: '17:00' })} className={cx(ADD_SLOT_CLASS, 'w-auto px-3')}>
                + Time
              </button>
            ))}
          </div>
        </div>
      )}
      {!isTaskFieldHidden('startDate', config) && showDue && (
        <TaskWindowField
          startDate={form.startDate} dueDate={form.deadlineDate}
          onChange={v => patch({ startDate: v.startDate, deadlineDate: v.dueDate })}
        />
      )}
    </div>
  )
}
