// ─────────────────────────────────────────────────────────────────────────────
//  UnifiedPlanModal — THE FORM (one item, migration 155)
//  The single source of truth while the Add sheet is open: one form for every
//  item — a task, a slot and a repeat are its parts, not three editors. Seeded
//  from the request's defaults (a new item) or from the saved rows read as one
//  item (sheetRules.itemFromRows); saved as the items contract's ItemInput.
//  Pure — scripts/verify-sheet-rules.cjs runs it.
// ─────────────────────────────────────────────────────────────────────────────

import type { TimeBlockCategory } from '../../../features/daily/types'
import type { TaskPriority, TaskDomain } from '../../../features/todo/types'
import type { GoogleTarget, ItemInput, ItemLink, RepeatEnd, RepeatInput } from '../../../features/items/itemTypes'
import {
  cleanDetails, defaultType, detailFields, detailsOf as detailsDef, readAmount, type DetailCurrency, type ItemDetails, type MediaType,
} from '../../../features/items/categoryDetails'
import type { QuickAddResult } from '../../../features/items/quickAdd'
import { DOMAIN_LABEL } from '../../../features/todo/domainColors'
import { cleanLabels } from '../../../features/todo/taskLabels'
import { phoneTimeZone } from '../../utils/timeZone'
import { SERVER_EVENT_TIME_ZONE } from '../../../features/calendar/calendarEventRules'
import {
  columnsFromRepeatInput, defaultGoogleTarget, effectiveGoogleTarget, repeatFromQuick,
} from '../../../features/items/sheetRules'
import { weekdayOfIso } from '../../../features/daily/recurrence'
import {
  WEEKDAYS, repeatFormFromRow, repeatRowFromForm, repeatStart, editedRepeatStart, defaultScheduleCategory,
  clampDurationMinutes, pickRecurrence, taskSourceTypeForBlock, type RepeatFormFields,
} from './planModal.config'
import type { PlanDefaults, PlanMode, PlanSource } from './planModal.types'
import { cleanPlace, placeFromText, type ItemPlace } from '../../../features/items/itemPlace'
import { lengthToEnd, type EndProblem } from './itemScreenRules'
import {
  alertsForKind, alertsOnAllDaySwitch, cleanItemUrl, repeatEndProblem, type CalendarField,
} from '../../../features/items/itemCalendarFields'

/** The rows behind "+ Notes / + Priority / + Deadline / + Area / + Google list". */
export type SheetRow = 'notes' | 'priority' | 'deadline' | 'area' | 'list'

/** The category's add-on fields as the screen holds them (215; items/categoryDetails): the cost as typed. */
export interface DetailsForm {
  /** Media's type (Movie / TV / Cinema); null for a category without types. */
  type: MediaType | null
  with: string[]
  /** The cost as typed ('' = none); read at save (categoryDetails.readAmount). */
  cost: string
  currency: DetailCurrency
  seats: string
  booking: string
  on: string
}

/** A title picked from TMDB's search that isn't in the library yet: added through the library's own add inside the
 *  save (never on pick — a cancelled screen leaves nothing behind), then linked. */
/** A TMDB title picked on the screen, added to the library by the save; a show may carry its episode (its next one,
 *  filled on the pick), which the save puts on the link it makes. */
export interface PendingTitle { kind: 'movie' | 'tv'; tmdbId: number; title: string; season?: number; episode?: number }

export interface PlanForm extends RepeatFormFields {
  /** What is saved as the title (quick add's words taken out; the field shows what was typed). */
  title: string
  notes: string
  priority: TaskPriority
  domain: TaskDomain
  /** The item's category (the screen's top row): the slot's and a repeat's colour group, and what decides its
   *  add-on fields (215). An item with no slot keeps it in its details. */
  category: TimeBlockCategory
  /** The category's add-on fields (items/categoryDetails). */
  details: DetailsForm
  /** The owner changed the category or a detail here: an edit sends the details only then, or when the task had some. */
  detailsTouched: boolean
  /** The thing it plans (210): the caller's (a Plan button), the task's own, or one picked in the details. */
  link: ItemLink | null
  /** The owner picked or took off the thing here: only then is `link` sent instead of the caller's (null = take the
   *  saved one off, 215). */
  linkTouched: boolean
  /** A TMDB title picked here, added to the library by the save (then it is `link`). */
  pendingTitle: PendingTitle | null
  /** YYYY-MM-DD; null = no date (Inbox). A repeat's start; "This day": that day. */
  date: string | null
  /** HH:MM; null = anytime. */
  time: string | null
  /** Minutes; null = doesn't block time (only with a time). */
  duration: number | null
  /** "+ Deadline" (due by): '' = none. */
  deadlineDate: string
  deadlineTime: string
  /** tasks.start_date — "do it between" (069), behind "+ Deadline". */
  startDate: string
  /** The Google choice picked for this item; null = follow the default. */
  googlePick: GoogleTarget | null
  googleListTitle: string
  /** The task's own labels (migration 180) — a repeat's rule has none. */
  labels: string[]
  /** The owner changed the labels here: only then are they sent (a save that didn't touch them keeps them — a sheet
   *  opened without its task's labels never wipes them). */
  labelsTouched: boolean
  /** The zone the times are in (183): a new item's is the phone's (or the caller's — a match's kick-off is Oslo's); a
   *  saved one's as stored (null = the home zone). The save sends exactly this — what the sheet shows is what is stored. */
  timeZone: string | null
  /** Where it happens (186): EnTur's place, a saved Home/Work, or typed text. */
  place: ItemPlace | null
  /** The owner changed the place here. An edit sends it when it was known or changed (never a null over a place the
   *  sheet wasn't told about). */
  placeTouched: boolean
  /** Alert and Second Alert (193): minutes before, in order; [] = none; null = the area's own alert
   *  (itemCalendarFields.alertRows / alertsOf turn it into the screen's two rows and back). */
  alerts: number[] | null
  /** Show As (193): null = by its length (Busy with one, Free without and all day). */
  showAs: 'busy' | 'free' | null
  /** The link as typed ('' = none); cleaned at save (itemCalendarFields.cleanItemUrl — calendarFieldsProblem says why
   *  one can't be used). */
  url: string
  /** Travel Time (193): 0 = none, 5–120 minutes; null = automatic (Time to Leave from the place's pin). */
  travelMinutes: number | null
  /** End Repeat (193), for a repeat's rule: null = never. */
  repeatEnd: RepeatEnd | null
  /** The fields the owner changed here: an edit sends a field only when the sheet knew it (the rows had its column)
   *  or the owner changed it — never a value over one the sheet wasn't told about. Set them through withCalendarField. */
  calendarTouched: CalendarField[]
  /** A repeating item opened on one of its days: that day only, or the rule. */
  scope: 'day' | 'all'
  /** The rule's start while "This day" shows the day (and the day while "All days" shows the start). */
  otherDate: string | null
  /** Optional rows open. */
  shown: SheetRow[]
  /** An end picked on the Ends row that can't be a length (before the start, or more than 24 hours after it): the row
   *  shows it struck through and nothing saves until it is fixed. Never saved itself. */
  badEnd: { date: string; time: string; problem: EndProblem } | null
}

export interface FormSeed {
  /** Which alias opened a new item: a slot ('schedule'), a repeat ('recurring') or a task. */
  mode: PlanMode
  defaults?: PlanDefaults
  source?: PlanSource
  /** An edit: the saved rows as one item (sheetRules.itemFromRows). */
  item?: ItemInput | null
  /** The Google choice saved on it (155), null on an older row. */
  storedGoogle?: GoogleTarget | null
  /** The saved slot's or repeat's category. */
  category?: TimeBlockCategory | null
  /** The saved task's window opening edge. */
  startDate?: string | null
  /** A repeating item opened on this day. */
  occurrenceDate?: string | null
  /** The saved task's link (210; linkKinds.taskLinkOf). */
  link?: ItemLink | null
  today: string
  /** The next half hour (planModal.config's nextPlanTime). */
  nextTime: string
}

/** A saved cost as the field shows it: a whole amount as it is, else two decimals after a comma ("149,50"). */
export function costText(amount: number): string {
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2).replace('.', ',')
}

/**
 * The details the screen starts with: the saved ones whatever category they were saved under (a repeat's category
 * changed since; the save's cleanDetails keeps only what fits), else the category's first type and nothing filled.
 */
export function detailsForm(category: TimeBlockCategory, saved: ItemDetails | null | undefined, type?: MediaType | null): DetailsForm {
  const d = saved ?? null
  return {
    type: d?.type ?? (type && defaultType(category) ? type : defaultType(category) ?? null),
    with: d?.with ?? [],
    cost: d?.cost ? costText(d.cost.amount) : '',
    currency: d?.cost?.currency ?? 'NOK',
    seats: d?.seats ?? '',
    booking: d?.booking ?? '',
    on: d?.on ?? '',
  }
}

/** A media type that fits a link: a show plans TV. */
const typeOfLink = (link: ItemLink | null | undefined): MediaType | null => (link && link.kind === 'tv' ? 'tv' : null)

const NO_REPEAT: RepeatFormFields = {
  recurrence: 'none', weeklyDays: WEEKDAYS, monthWeekday: null, customKind: 'every', repeatEvery: '2', repeatUnit: 'week', repeatDates: [],
}

/** Rows opened from the start: the ones that hold something. */
function shownRows(f: Pick<PlanForm, 'notes' | 'priority' | 'deadlineDate' | 'startDate' | 'domain'>): SheetRow[] {
  const rows: SheetRow[] = []
  if (f.notes.trim()) rows.push('notes')
  if (f.priority !== 'medium') rows.push('priority')
  if (f.deadlineDate || f.startDate) rows.push('deadline')
  if (f.domain !== 'personal') rows.push('area')
  return rows
}

export function buildInitialForm(seed: FormSeed): PlanForm {
  return seed.item ? formFromItem(seed, seed.item) : formFromDefaults(seed)
}

function formFromDefaults({ mode, defaults: d = {}, source, today, nextTime }: FormSeed): PlanForm {
  const domain = d.domain ?? 'personal'
  const category = d.category ?? defaultScheduleCategory(domain, source?.taskSourceType ?? taskSourceTypeForBlock(source?.sourceType))
  const slot = mode !== 'task' || !!d.scheduled
  const date = d.date ?? d.dueDate ?? (d.section === 'inbox' ? null : today)
  const time = mode === 'task' && !d.scheduled ? (d.dueTime ?? null) : (d.startTime ?? nextTime)
  // Weekly with no days of its own repeats on its day's weekday (pickRecurrence), never Mon–Fri.
  const weekday = weekdayOfIso(date ?? today)
  const repeat: Partial<RepeatFormFields> = d.recurrence && d.recurrence !== 'none'
    ? (d.daysOfWeek ? { recurrence: d.recurrence, weeklyDays: d.daysOfWeek } : pickRecurrence(NO_REPEAT, d.recurrence, weekday))
    : mode === 'recurring' ? pickRecurrence(NO_REPEAT, 'weekly', weekday) : {}
  const base = {
    ...NO_REPEAT,
    ...repeat,
    title: d.title ?? '',
    notes: d.notes ?? '',
    priority: d.priority ?? 'medium',
    domain,
    category,
    details: detailsForm(category, null, d.mediaType ?? typeOfLink(source?.link)),
    detailsTouched: false,
    link: source?.link ?? null,
    linkTouched: false,
    pendingTitle: null,
    date: date ?? (repeat.recurrence ? today : null),
    time,
    duration: time && slot ? (d.duration ?? 60) : null,
    deadlineDate: '',
    deadlineTime: '',
    startDate: d.startDate ?? '',
    googlePick: d.gcal ? 'calendar' as const : null,
    googleListTitle: DOMAIN_LABEL[domain],
    labels: [],
    labelsTouched: false,
    timeZone: d.timeZone ?? phoneTimeZone(),
    place: null,
    placeTouched: false,
    alerts: null,
    showAs: null,
    url: '',
    travelMinutes: null,
    repeatEnd: null,
    calendarTouched: [],
    scope: 'all' as const,
    otherDate: null,
    badEnd: null,
  }
  return { ...base, shown: shownRows(base) }
}

function formFromItem({ storedGoogle, category: slotCategory, startDate, occurrenceDate, link }: FormSeed, item: ItemInput): PlanForm {
  // The slot's or repeat's category decides; an item with neither keeps it in its details (215, one source).
  const saved = item.details ? cleanDetails(item.details) : null
  const category = slotCategory ?? saved?.category ?? defaultScheduleCategory(item.domain, item.source?.type)
  const repeat = item.repeat ? repeatFormFromRow(columnsFromRepeatInput(item.repeat)) : {}
  // An older row (no saved choice) that sits where the default would put it
  // keeps following the default; one that doesn't keeps where it is.
  const googlePick = storedGoogle ?? (item.google === defaultGoogleTarget(item) ? null : item.google)
  const base = {
    ...NO_REPEAT,
    ...repeat,
    title: item.title,
    notes: item.notes ?? '',
    priority: item.priority,
    domain: item.domain,
    category,
    details: detailsForm(category, saved, typeOfLink(link)),
    detailsTouched: false,
    link: link ?? null,
    linkTouched: false,
    pendingTitle: null,
    date: item.date,
    time: item.time,
    duration: item.durationMinutes,
    deadlineDate: item.deadline?.date ?? '',
    deadlineTime: item.deadline?.time ?? '',
    startDate: startDate ?? '',
    googlePick,
    googleListTitle: DOMAIN_LABEL[item.domain],
    labels: item.labels ?? [],
    labelsTouched: false,
    timeZone: item.timeZone ?? null,
    // A cinema trip with no slot keeps its cinema by name in its details (215).
    place: item.place ?? (saved?.cinema ? placeFromText(saved.cinema) : null),
    placeTouched: false,
    alerts: alertsForKind(item.alerts ?? null, !item.time),
    showAs: item.showAs ?? null,
    url: item.url ?? '',
    travelMinutes: item.travelMinutes ?? null,
    repeatEnd: item.repeatEnd ?? null,
    calendarTouched: [],
    scope: 'all' as const,
    otherDate: item.repeat && occurrenceDate ? occurrenceDate : null,
    badEnd: null,
  }
  return { ...base, shown: shownRows(base) }
}

/** "This day" ⇄ "All days": the date shown swaps between the day and the rule's start. */
export function switchScope(f: PlanForm, scope: 'day' | 'all'): PlanForm {
  if (scope === f.scope || !f.otherDate) return f
  return { ...f, scope, date: f.otherDate, otherDate: f.date }
}

/** The repeat being saved, or null (no repeat, or only one day of it). */
export function repeatOfForm(f: PlanForm): Omit<RepeatInput, 'startsOn'> | null {
  if (f.recurrence === 'none' || f.scope === 'day') return null
  const row = repeatRowFromForm(f)
  return {
    kind: row.repeat_kind,
    ...(row.repeat_kind !== 'dates' ? { daysOfWeek: row.days_of_week } : {}),
    ...(row.repeat_kind === 'interval' ? { interval: row.repeat_interval ?? 2, unit: row.repeat_unit ?? 'week' } : {}),
    ...(row.repeat_kind === 'dates' ? { dates: row.repeat_dates ?? [] } : {}),
  }
}

/** The shape the Google rules read: time, length and whether it repeats. */
export function shapeOf(f: PlanForm): Pick<ItemInput, 'time' | 'durationMinutes' | 'repeat'> {
  const r = repeatOfForm(f)
  return { time: f.time, durationMinutes: f.time ? f.duration : null, repeat: r ? { ...r, startsOn: f.date ?? '' } : null }
}

// ── Save ─────────────────────────────────────────────────────────────────────

/**
 * What the sheet saves besides the contract's ItemInput — the data layer
 * should take these (asked for in the contract changes): the slot's category
 * and colour, the window's opening edge, and the slot's own origin when it
 * differs from the task's (a TV episode: the task is the series, 077).
 * `source.id` may be missing (a training session planned with no routine).
 */
export interface SheetExtras {
  category?: TimeBlockCategory
  color?: string
  startDate?: string | null
  blockSource?: { type: string; id: string | null; seasonNumber?: number; episodeNumber?: number } | null
}
export type SheetItemInput = Omit<ItemInput, 'source'> & { source?: { type: string; id: string | null } | null } & SheetExtras

export interface SaveContext {
  /** The edit's saved item (its ids, its Google choice, its repeat's start). */
  item?: ItemInput | null
  occurrenceDate?: string | null
  googleConnected: boolean
  /** The Google Tasks list the typed name resolved to. */
  googleTaskListId?: string | null
  source?: PlanSource
  color?: string
  today: string
}

export function inputFromForm(f: PlanForm, ctx: SaveContext): SheetItemInput {
  const editingRepeat = !!ctx.item?.scheduleBlockId
  const day = editingRepeat && f.scope === 'day'
  const repeat = repeatOfForm(f)
  const date = repeat ? startOfRepeat(f, ctx) : f.date
  const shape = { time: f.time, repeat: repeat ? { ...repeat, startsOn: date ?? ctx.today } : null }
  const google = ctx.googleConnected ? effectiveGoogleTarget(shape, f.googlePick) : (ctx.item?.google ?? 'none')
  const src = ctx.source
  return {
    taskId: ctx.item?.taskId ?? null,
    blockId: ctx.item?.blockId ?? null,
    scheduleBlockId: ctx.item?.scheduleBlockId ?? null,
    scope: editingRepeat ? (day ? 'day' : 'all') : 'item',
    occurrenceDate: day ? ctx.occurrenceDate ?? null : null,
    title: f.title.trim(),
    notes: f.notes.trim() || null,
    domain: f.domain,
    priority: f.priority,
    date,
    time: f.time,
    durationMinutes: f.time && f.duration ? clampDurationMinutes(f.duration) : null,
    deadline: f.deadlineDate ? { date: f.deadlineDate, time: f.deadlineTime || null } : null,
    repeat: repeat && date ? { ...repeat, startsOn: date } : null,
    google,
    googleTaskList: google === 'tasks' || google === 'both' ? ctx.googleTaskListId ?? ctx.item?.googleTaskList ?? null : null,
    // A task's labels, only when changed here (untouched, the database keeps them); a repeat's rule has none.
    ...(repeat || !f.labelsTouched ? {} : { labels: cleanLabels(f.labels) }),
    // The zone the sheet shows (183): a new item's (the phone's), a saved one's (none = the home zone) or one picked
    // with the chip — always sent, so a one-off turned into a repeat (or back) keeps the clock it showed.
    timeZone: f.timeZone ?? SERVER_EVENT_TIME_ZONE,
    // Its place (186): a new item's, an edit's when the sheet knew it or the owner changed it.
    ...(f.placeTouched || !ctx.item || ctx.item.place !== undefined ? { place: f.place ? cleanPlace(f.place) : null } : {}),
    ...calendarFieldsInput(f, ctx, !!repeat),
    source: src
      ? { type: src.taskSourceType ?? taskSourceTypeForBlock(src.sourceType) ?? src.sourceType ?? 'manual', id: src.sourceId ?? null }
      : ctx.item?.source ? { type: ctx.item.source.type, id: ctx.item.source.id || null } : null,
    category: f.category,
    ...(ctx.color ? { color: ctx.color } : {}),
    startDate: f.startDate || null,
    blockSource: src?.sourceType
      ? { type: src.sourceType, id: src.sourceId ?? null, seasonNumber: src.episodeInfo?.seasonNumber, episodeNumber: src.episodeInfo?.episodeNumber }
      : null,
    // The thing it plans: one picked here (or taken off an edit: null, 215), else the caller's (a Plan button) — never
    // a second write (210). A repeat's rule has no task to link.
    ...(f.linkTouched ? (f.link ? { link: f.link } : ctx.item?.taskId && !repeat ? { link: null } : {}) : src?.link ? { link: src.link } : {}),
    ...(repeat ? {} : detailsInput(f, ctx)),
  }
}

/** The details a save sends (215): a new item's; an edit's when the owner changed the category or a detail, or when
 *  the task had some — never details over an older item the screen didn't change. A repeat's rule has none. */
function detailsInput(f: PlanForm, ctx: SaveContext): Pick<ItemInput, 'details'> {
  if (ctx.item && !f.detailsTouched && !f.linkTouched && !ctx.item.details) return {}
  return { details: detailsOf(f) }
}

/**
 * The form's details as 215 keeps them: cleaned under the item's category — only its fields for its type (what another
 * category held stays on the screen, never saved under this one). The category and a cinema trip's cinema go along;
 * the database keeps them only for an item with no slot or repeat (one source).
 */
export function detailsOf(f: Pick<PlanForm, 'category' | 'details' | 'place'>): ItemDetails {
  const d = f.details
  const amount = readAmount(d.cost)
  return cleanDetails({
    type: d.type ?? undefined, with: d.with, seats: d.seats, booking: d.booking, on: d.on, cinema: f.place?.name,
    cost: 'amount' in amount && amount.amount != null ? { amount: amount.amount, currency: d.currency } : undefined,
  }, f.category) ?? { category: f.category }
}

/** The kinds of thing a category's fields hold (Media: a movie or a show; Games: a game) — no other kind is any
 *  category's (a shop thing, a wish, a match, a routine stay whatever the category). */
const OWNED_KINDS = ['movie', 'tv', 'game'] as const
const linkedKind = (f: Pick<PlanForm, 'link' | 'pendingTitle'>) => f.pendingTitle?.kind ?? (f.link && 'id' in f.link ? f.link.kind : null)

/** The kinds a category (and, for Media, a type) holds. */
function holds(category: TimeBlockCategory, type?: MediaType | null): string[] {
  const def = detailsDef(category)
  if (!def?.linkKind) return []
  const types = type ? [type] : def.types?.map(t => t.value) ?? [undefined]
  return types.map(t => def.linkKind!(t ?? undefined))
}

/** The category picked on the top row: its fields (withDetails), and a movie, show or game it can't hold taken off
 *  (215 — on an edit the save sends "none"). */
export function withCategory(f: Pick<PlanForm, 'category' | 'details' | 'link' | 'pendingTitle'>, category: TimeBlockCategory): Partial<PlanForm> {
  const kind = linkedKind(f)
  const drop = !!kind && (OWNED_KINDS as readonly string[]).includes(kind) && !holds(category).includes(kind)
  return { ...withDetails(f, { category }), ...(drop ? { link: null, pendingTitle: null, linkTouched: true } : {}) }
}

/** Media's type picked: a show doesn't fit a movie (and back) — taken off. */
export function withMediaType(f: Pick<PlanForm, 'category' | 'details' | 'link' | 'pendingTitle'>, type: MediaType): Partial<PlanForm> {
  const kind = linkedKind(f)
  const drop = (kind === 'movie' || kind === 'tv') && !holds(f.category, type).includes(kind)
  return { ...withDetails(f, { details: { type } }), ...(drop ? { link: null, pendingTitle: null, linkTouched: true } : {}) }
}

/** Why the details can't be saved as typed (a cost that isn't an amount), or null. */
export function detailsProblem(f: Pick<PlanForm, 'category' | 'details'>): string | null {
  if (!detailFields(f.category, f.details.type ?? undefined).includes('cost')) return null
  const amount = readAmount(f.details.cost)
  return 'problem' in amount ? amount.problem : null
}

/**
 * A change of the category or a detail (the top row, the Details section): marked touched, so an edit sends it. The
 * values stay on the form across a category change (switching back finds them); the save keeps only what fits.
 */
export function withDetails(f: Pick<PlanForm, 'category' | 'details'>, p: { category?: TimeBlockCategory; details?: Partial<DetailsForm> }): Partial<PlanForm> {
  const category = p.category ?? f.category
  const details = { ...f.details, ...p.details }
  if (!details.type && defaultType(category)) details.type = defaultType(category) ?? null
  return { category, details, detailsTouched: true }
}

/**
 * The calendar fields (193) a save sends: a new item's; an edit's when the sheet knew it (the rows had the column) or
 * the owner changed it. The link goes through cleanItemUrl; one it can't use goes as typed, so the database refuses it
 * with its message — never dropped without a word (the screen shows calendarFieldsProblem first). End Repeat only
 * with a repeat's rule (never "This day").
 */
function calendarFieldsInput(f: PlanForm, ctx: SaveContext, repeat: boolean): Partial<Pick<ItemInput, 'alerts' | 'showAs' | 'url' | 'travelMinutes' | 'repeatEnd'>> {
  const sends = (field: CalendarField, known: unknown) => !ctx.item || known !== undefined || f.calendarTouched.includes(field)
  const link = cleanItemUrl(f.url)
  return {
    ...(sends('alerts', ctx.item?.alerts) ? { alerts: f.alerts } : {}),
    ...(sends('showAs', ctx.item?.showAs) ? { showAs: f.showAs } : {}),
    ...(sends('url', ctx.item?.url) ? { url: 'url' in link ? link.url : f.url.trim() } : {}),
    ...(sends('travel', ctx.item?.travelMinutes) ? { travelMinutes: f.travelMinutes } : {}),
    ...(repeat && sends('repeatEnd', ctx.item?.repeatEnd) ? { repeatEnd: f.repeatEnd } : {}),
  }
}

/** A field changed by the owner: its value, and marked as touched (so an edit sends it). */
export function withCalendarField<K extends 'alerts' | 'showAs' | 'url' | 'travelMinutes' | 'repeatEnd'>(
  f: Pick<PlanForm, 'calendarTouched'>, key: K, value: PlanForm[K],
): Partial<PlanForm> {
  const field: CalendarField = key === 'travelMinutes' ? 'travel' : key
  return { [key]: value, calendarTouched: f.calendarTouched.includes(field) ? f.calendarTouched : [...f.calendarTouched, field] } as Partial<PlanForm>
}

/** Why the calendar fields can't be saved as they are, or null: a link the app can't use, an End Repeat before the start. */
export function calendarFieldsProblem(f: PlanForm, ctx: Pick<SaveContext, 'item' | 'today'>): string | null {
  return urlProblem(f) ?? repeatEndIssue(f, ctx)
}

/** Why the typed link can't be saved (cleanItemUrl's answer), or null — the URL row says it under itself. */
export function urlProblem(f: Pick<PlanForm, 'url'>): string | null {
  const link = cleanItemUrl(f.url)
  return 'problem' in link ? link.problem : null
}

/** Why the End Repeat can't be saved, or null: only a repeat's rule has one (never "This day"), checked against the
 *  start the save will give the repeat — the End Repeat row says it under itself. */
export function repeatEndIssue(f: PlanForm, ctx: Pick<SaveContext, 'item' | 'today'>): string | null {
  if (!repeatOfForm(f) || !f.repeatEnd) return null
  return repeatEndProblem(f.repeatEnd, startOfRepeat(f, { ...ctx, googleConnected: false }))
}

/** A new repeat starts on the sheet's date (picked dates: the earliest pick if
 *  earlier); a saved one keeps its start unless the choice counts from it
 *  (Monthly, every N) — planModal.config's editedRepeatStart. */
function startOfRepeat(f: PlanForm, ctx: SaveContext): string | null {
  const row = repeatRowFromForm(f)
  const from = f.date ?? ctx.today
  const saved = ctx.item?.repeat?.startsOn
  if (ctx.item?.scheduleBlockId) return editedRepeatStart({ ...f, date: from }, row, saved) ?? saved ?? from
  return repeatStart(row, from)
}

// ── Quick add in the title ───────────────────────────────────────────────────
//  The text fills the chips as it is typed; what a chip held before is kept
//  per part, so a part the text no longer says goes back to it, and "Keep
//  text" puts every part back. A part the text still says the same way is
//  left alone — a chip changed by hand stays changed while typing on.

type QuickPart = 'date' | 'time' | 'length' | 'repeat'
const QUICK_PARTS: QuickPart[] = ['date', 'time', 'length', 'repeat']
/** The chips' values before quick add filled them, per part. */
export type QuickBase = Partial<Record<QuickPart, Partial<PlanForm>>>

const REPEAT_KEYS = ['recurrence', 'weeklyDays', 'monthWeekday', 'customKind', 'repeatEvery', 'repeatUnit', 'repeatDates'] as const

function partValue(p: QuickPart, r: QuickAddResult | null): string | undefined {
  if (!r) return undefined
  if (p === 'date') return r.date
  if (p === 'time') return r.time
  if (p === 'length') return r.durationMinutes != null ? String(r.durationMinutes) : undefined
  return r.repeat ? JSON.stringify(r.repeat) : undefined
}

function partPatch(p: QuickPart, r: QuickAddResult, f: PlanForm, today: string): Partial<PlanForm> {
  if (p === 'date') return { date: r.date }
  // A time needs a day: an undated item read with a time is today's.
  if (p === 'time') return { time: r.time, ...(f.date || r.date ? {} : { date: today }) }
  if (p === 'length') return { duration: r.durationMinutes }
  const start = r.date ?? f.date ?? today
  return { ...NO_REPEAT, ...repeatFormFromRow(repeatFromQuick(r.repeat!, start)), ...(f.date ? {} : { date: start }) }
}

function keysOf(p: QuickPart, patch: Partial<PlanForm>): (keyof PlanForm)[] {
  return p === 'repeat' ? [...REPEAT_KEYS, ...('date' in patch ? ['date' as const] : [])] : (Object.keys(patch) as (keyof PlanForm)[])
}

export function applyQuickAdd(
  form: PlanForm, base: QuickBase, prev: QuickAddResult | null, next: QuickAddResult | null, today: string,
): { form: PlanForm; base: QuickBase } {
  let f = form
  const b: QuickBase = { ...base }
  for (const p of QUICK_PARTS) {
    const before = partValue(p, prev)
    const after = partValue(p, next)
    if (before === after) continue
    if (after !== undefined && next) {
      const patch = partPatch(p, next, f, today)
      if (!b[p]) b[p] = Object.fromEntries(keysOf(p, patch).map(k => [k, f[k]])) as Partial<PlanForm>
      f = { ...f, ...patch }
    } else if (b[p]) {
      f = { ...f, ...b[p] }
      delete b[p]
    }
  }
  return { form: f, base: b }
}

/** "Keep text": every part back as it was, the title as typed. */
export function keepQuickText(form: PlanForm, base: QuickBase, typed: string): PlanForm {
  let f = form
  for (const p of QUICK_PARTS) if (base[p]) f = { ...f, ...base[p] }
  return { ...f, title: typed }
}

/**
 * "All day" (owner, 16.10.2026: "there are no options to mark as all day"):
 * no time and no length, on Apple Calendar — an item with a day and no time
 * is an all-day event there (155). Both stays Both; anything else becomes
 * Calendar.
 */
export function withAllDay(f: Pick<PlanForm, 'googlePick'>): Partial<PlanForm> {
  return { time: null, duration: null, googlePick: f.googlePick === 'both' ? 'both' : 'calendar' }
}

/** A time added by hand gets no length (it doesn't block); a removed time takes its length with it. */
export function withTime(time: string | null): Partial<PlanForm> {
  return time ? { time } : { time: null, duration: null }
}

/** "No date" takes the time and length with it: a slot needs a day. */
/**
 * Move to today on the item screen (owner, 27.11.2026: "if its moved it is moved!"): the form's own day becomes
 * today — the screen's one save moves the slot and its due, as itemRules.movedToDay does for a row — and a deadline
 * already past is dropped so the due follows the slot. Time and length stay.
 */
export function movedFormToDay(f: Pick<PlanForm, 'date' | 'deadlineDate'>, day: string): Partial<PlanForm> {
  return {
    ...(!f.date || f.date < day ? { date: day } : {}),
    ...(f.deadlineDate && f.deadlineDate < day ? { deadlineDate: '', deadlineTime: '' } : {}),
  }
}

export function withDate(date: string | null): Partial<PlanForm> {
  return date ? { date } : { date: null, time: null, duration: null }
}

/**
 * An end picked on the item screen's Ends row (its own day and time), read back as the length the item stores: the
 * next day is fine, up to 24 hours after the start (080). One that can't be a length is held as `badEnd`.
 */
export function withEnd(f: Pick<PlanForm, 'date' | 'time'>, end: { date: string; time: string }): Partial<PlanForm> {
  if (!f.date || !f.time) return {}
  const read = lengthToEnd({ date: f.date, time: f.time }, end)
  return 'duration' in read ? { duration: read.duration, badEnd: null } : { badEnd: { ...end, problem: read.problem } }
}

/**
 * The item screen's All-day switch. On: no time and no length — an item on a calendar stays there as an all-day
 * event (withAllDay), one on Google Tasks or nowhere just loses its time. Off: a time (the next half hour) and an
 * hour, as Apple starts a timed event. Either way an alert within the day is dropped (alertsOnAllDaySwitch: "30
 * minutes before" means nothing all day, "On the day (09:00)" nothing with a time).
 */
export function withAllDaySwitch(
  f: Pick<PlanForm, 'googlePick'> & Partial<Pick<PlanForm, 'alerts' | 'calendarTouched'>>, on: boolean, target: GoogleTarget, nextTime: string,
): Partial<PlanForm> {
  const alerts = f.alerts === undefined ? undefined : alertsOnAllDaySwitch(f.alerts)
  const kept = alerts === undefined || same(alerts, f.alerts) ? {} : withCalendarField({ calendarTouched: f.calendarTouched ?? [] }, 'alerts', alerts)
  if (on) return { ...(target === 'calendar' || target === 'both' ? withAllDay(f) : withTime(null)), badEnd: null, ...kept }
  return { time: nextTime, duration: 60, badEnd: null, ...kept }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/**
 * "Undo changes" on an edit: the form as the screen opened, to be sent as one save. A field the owner changed is
 * marked touched, so the save sends it back (labels, the place, the calendar fields); one never touched still goes
 * only when the sheet knew it.
 */
export function revertedForm(opened: PlanForm, now: PlanForm): PlanForm {
  return {
    ...opened,
    labelsTouched: opened.labelsTouched || now.labelsTouched,
    placeTouched: opened.placeTouched || now.placeTouched,
    calendarTouched: [...new Set([...opened.calendarTouched, ...now.calendarTouched])],
    detailsTouched: opened.detailsTouched || now.detailsTouched,
    // The opened link is sent back (or, when it had none, the one picked since is taken off).
    linkTouched: opened.linkTouched || now.linkTouched,
    shown: now.shown.filter(r => r !== 'list'),
  }
}

/** The form's values alone — without which rows are open and what was touched (they only steer the save). */
export function formValuesKey(f: PlanForm): string {
  return JSON.stringify({
    ...f, shown: undefined, labelsTouched: undefined, placeTouched: undefined, calendarTouched: undefined, detailsTouched: undefined, linkTouched: undefined,
  })
}

/** What the item screen saves when this form changes — everything but which optional rows are open. */
export function formContentKey(f: PlanForm): string {
  return JSON.stringify({ ...f, shown: undefined })
}
