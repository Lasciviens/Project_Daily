// ─────────────────────────────────────────────────────────────────────────────
//  ✨ on the item screen (step 4 of docs/features/item-screen-plan.md): a
//  checked fill (items/itemFill.cleanItemFill) put into the screen's form —
//  only into rows the screen shows and lets change for this item, through the
//  same helpers a tap uses (quick add's date / time / length / repeat, the
//  All-day switch, the Ends row, withCalendarField), so a filled form is one
//  the owner could have made by hand. Returns which fields changed and which
//  rows to mark until the owner keeps them. Pure — verify-item-fill runs it.
// ─────────────────────────────────────────────────────────────────────────────

import type { ItemFill } from '../../../features/items/itemFill'
import type { QuickAddResult, QuickRepeat } from '../../../features/items/quickAdd'
import type { RepeatEnd } from '../../../features/items/itemTypes'
import { cleanPlace } from '../../../features/items/itemPlace'
import { alertChoices, cleanItemUrl, repeatEndProblem } from '../../../features/items/itemCalendarFields'
import { effectiveGoogleTarget } from '../../../features/items/sheetRules'
import { shiftDateStr } from '../../utils/dateUtils'
import { isScheduleFieldHidden, isTaskFieldHidden } from './planModal.config'
import { applyQuickAdd, repeatOfForm, shapeOf, withAllDaySwitch, withCalendarField, withEnd, type PlanForm } from './planForm'
import { screenParts } from './itemScreenRules'
import type { PlanModalConfig } from './planModal.types'

/** What the screen is showing: the same inputs ItemForm reads. */
export interface FillScreen {
  today: string
  /** The next half hour (All-day off starts there). */
  nextTime: string
  config?: PlanModalConfig
  /** Editing: what the saved item is (a one-off doesn't become a repeat here, nor a repeat a one-off). */
  savedKind?: 'one-off' | 'repeat'
  /** A repeating item opened on one of its days. */
  occurrenceDate?: string | null
  /** The Calendar row shows (Google connected, or an Apple area). */
  choiceShown: boolean
}

/** A field ✨ changed, as the review bar and the toast name it. */
export type FillField = 'title' | 'day' | 'time' | 'end' | 'all day' | 'repeat' | 'end repeat' | 'location' | 'travel time'
  | 'alerts' | 'show as' | 'link' | 'notes' | 'deadline' | 'deadline time' | 'do it between' | 'priority' | 'area'

export interface FillResult {
  form: PlanForm
  /** What changed, in the screen's order (empty: the sentence gave nothing this screen takes). */
  fields: FillField[]
  /** The row labels to mark with ✨ (ItemRows' labels; Location, URL and Notes are marked by ItemForm). */
  rows: string[]
}

const REPEAT_KEYS = ['recurrence', 'weeklyDays', 'monthWeekday', 'customKind', 'repeatEvery', 'repeatUnit', 'repeatDates'] as const

/** The fill's repeat in quick add's words (the same day bubbles: every day and weekdays are weekly sets of days). */
function quickRepeatOf(fill: ItemFill): QuickRepeat | null {
  switch (fill.repeat) {
    case 'daily': return { kind: 'weekly', daysOfWeek: [0, 1, 2, 3, 4, 5, 6] }
    case 'weekdays': return { kind: 'weekly', daysOfWeek: [1, 2, 3, 4, 5] }
    case 'weekly': return { kind: 'weekly', ...(fill.repeatDays ? { daysOfWeek: fill.repeatDays } : {}) }
    case 'monthly': return { kind: 'monthly' }
    case 'every':
      if (!fill.repeatEvery || !fill.repeatUnit) return null
      return { kind: 'interval', interval: fill.repeatEvery, unit: fill.repeatUnit, ...(fill.repeatDays ? { daysOfWeek: fill.repeatDays } : {}) }
    default: return null
  }
}

function endOf(fill: ItemFill): RepeatEnd | null {
  if (fill.repeatUntil) return { until: fill.repeatUntil }
  return fill.repeatCount ? { count: fill.repeatCount } : null
}

/** The fill put into the form. A field the screen hides or won't change for this item is left as it was. */
export function fillForm(form: PlanForm, fill: ItemFill, s: FillScreen): FillResult {
  const hidden = (k: Parameters<typeof isTaskFieldHidden>[0]) => isTaskFieldHidden(k, s.config)
  const oneDay = !!s.occurrenceDate && form.scope === 'day'
  // A saved repeat's rule and start stay as they are (its Repeat and Starts rows count from them); its time may move.
  const savedRule = s.savedKind === 'repeat' && !oneDay
  const canRepeat = !s.savedKind && !isScheduleFieldHidden('recurrence', s.config)
  const target = (f: PlanForm) => effectiveGoogleTarget(shapeOf(f), f.googlePick)

  // Day, time, length and repeat: quick add's own rules (a time needs a day — today's; a weekly repeat with no days
  // repeats on its day's weekday).
  const quick: QuickAddResult = { title: '', read: [] }
  if (fill.date && !savedRule) quick.date = fill.date
  if (fill.startTime) quick.time = fill.startTime
  if (fill.durationMinutes !== undefined && (fill.startTime || form.time)) quick.durationMinutes = fill.durationMinutes
  const repeat = canRepeat ? quickRepeatOf(fill) : null
  if (repeat) quick.repeat = repeat
  let f: PlanForm = { ...applyQuickAdd(form, {}, null, quick, s.today).form }
  if (fill.startTime) f.badEnd = null

  // An end: on the start's day, or the next when it isn't after the start (the Ends row's rule: at most 24 hours).
  if (fill.endTime && f.date && f.time) {
    const end = { date: fill.endTime > f.time ? f.date : shiftDateStr(f.date, 1), time: fill.endTime }
    const read = withEnd(f, end)
    if ('duration' in read && read.duration) f = { ...f, ...read }
  }
  // All day: the switch's own rule (on a calendar it stays there all day); only on a day.
  if (fill.allDay && !fill.startTime && f.date) f = { ...f, ...withAllDaySwitch(f, true, target(f), s.nextTime) }

  // End Repeat: only on a repeat's rule (never "This day": repeatOfForm), never one that ends before it starts.
  const end = endOf(fill)
  if (end && repeatOfForm(f) && !repeatEndProblem(end, f.date)) f = { ...f, ...withCalendarField(f, 'repeatEnd', end) }

  // The rows a slot or a repeat keeps — only when the filled item shows them (itemScreenRules.screenParts).
  const { slotFields } = screenParts(f, {
    occurrenceDate: s.occurrenceDate, choiceShown: s.choiceShown, calendarHidden: isScheduleFieldHidden('gcal', s.config), target: target(f),
  })
  if (slotFields) {
    const place = fill.place ? cleanPlace({ name: fill.place }) : null
    if (place) f = { ...f, place, placeTouched: true }
    if (fill.travelMinutes !== undefined) f = { ...f, ...withCalendarField(f, 'travelMinutes', fill.travelMinutes) }
    // An all-day item's alerts are its own list (on the day, 1, 2 or 7 days before, at 09:00).
    if (fill.alerts && fill.alerts.every(m => alertChoices(!f.time).includes(m))) f = { ...f, ...withCalendarField(f, 'alerts', [...fill.alerts]) }
    if (fill.showAs) f = { ...f, ...withCalendarField(f, 'showAs', fill.showAs) }
    const link = fill.url ? cleanItemUrl(fill.url) : null
    if (link && 'url' in link && link.url) f = { ...f, ...withCalendarField(f, 'url', link.url) }
  }

  if (fill.title) f.title = fill.title
  // Notes are added under what is there, never over it.
  if (fill.notes && !hidden('notes') && !form.notes.includes(fill.notes)) {
    f.notes = form.notes.trim() ? `${form.notes.trimEnd()}\n${fill.notes}` : fill.notes
  }
  if (fill.deadlineDate && !hidden('dueDate')) f.deadlineDate = fill.deadlineDate
  if (fill.deadlineTime && f.deadlineDate && !hidden('dueDate') && !hidden('dueTime')) f.deadlineTime = fill.deadlineTime
  if (fill.doFrom && f.deadlineDate && fill.doFrom <= f.deadlineDate && !hidden('dueDate') && !hidden('startDate')) f.startDate = fill.doFrom
  if (fill.priority && !hidden('priority')) f.priority = fill.priority
  if (fill.area && !hidden('domain')) f.domain = fill.area

  return { form: f, ...changesOf(form, f) }
}

/** What differs between the form before and after, as fields and as the rows to mark. */
function changesOf(a: PlanForm, b: PlanForm): Omit<FillResult, 'form'> {
  const diff = (...keys: (keyof PlanForm)[]) => keys.some(k => JSON.stringify(a[k]) !== JSON.stringify(b[k]))
  const fields: FillField[] = []
  const rows: string[] = []
  const mark = (field: FillField, ...labels: string[]) => { fields.push(field); rows.push(...labels) }
  if (diff('title')) mark('title')
  if (diff('date')) mark('day', 'Date', 'Starts')
  if (a.time && !b.time) mark('all day', 'All-day', 'Starts')
  else if (diff('time')) mark('time', 'Starts', ...(!a.time ? ['All-day'] : []))
  // A new start keeps the length, so its end moves too.
  if (b.time && (diff('duration') || diff('time'))) mark('end', 'Ends')
  if (diff(...REPEAT_KEYS)) mark('repeat', 'Repeat')
  if (diff('repeatEnd')) mark('end repeat', 'End Repeat')
  if (diff('place')) mark('location', 'Location')
  if (diff('travelMinutes')) mark('travel time', 'Travel Time')
  if (diff('alerts')) mark('alerts', 'Alert', ...((b.alerts?.length ?? 0) > 1 ? ['Second Alert'] : []))
  if (diff('showAs')) mark('show as', 'Show As')
  if (diff('url')) mark('link', 'URL')
  if (diff('notes')) mark('notes', 'Notes')
  if (diff('deadlineDate')) mark('deadline', 'Deadline')
  if (diff('deadlineTime')) mark('deadline time', 'Deadline time')
  if (diff('startDate')) mark('do it between', 'Do it between')
  if (diff('priority')) mark('priority', 'Priority')
  if (diff('domain')) mark('area', 'Area')
  return { fields: [...new Set(fields)], rows: [...new Set(rows)] }
}

/** "title, day, time and location" — the fields as the review bar and the toast say them. */
export function fillWords(fields: readonly FillField[]): string {
  const words = fields.map(f => (f === 'alerts' ? 'alert' : f))
  return words.length <= 1 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
}
