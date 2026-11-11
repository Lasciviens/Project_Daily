// ─────────────────────────────────────────────────────────────────────────────
//  UnifiedPlanModal — THE ONE FORM, drawn as the item screen (step 1 of
//  docs/features/item-screen-plan.md; owner, 10.11.2026). Pure view: reads
//  `form`, writes via `patch`; the title's quick add and the saving run in
//  UnifiedPlanModal. Grouped rows under Apple's headers:
//
//    [Title                                    ]         (quick add: Read as …)
//    LOCATION   ⌖ Location · Travel Time                 (a slot: a time, a repeat or all day)
//    TIME       Date · All-day · Starts [Tue 10.11.2026] [17:30]
//               Ends [Tue 10.11.2026] [18:30] · the day's timeline · Time Zone · Repeat · End Repeat
//    OPTIONS    Calendar  Google Calendar · busy  ·  List (a Google Task's)
//               Alert · Second Alert · Show As           (a slot)
//    DETAILS    URL (a slot) · Notes
//    PLANNING   Priority · Area · Category · Labels · Deadline · Deadline time · Do it between
//               Delete Item                              (an edit)
//
//  Step 2's rows (Travel Time, the alerts, Show As, URL, End Repeat — 193) are
//  in CalendarFieldRows.tsx and EndRepeatRows.tsx; they show only where a slot
//  or a repeat keeps them (itemScreenRules.screenParts).
//
//  Every row may carry a mark for where its field goes (Settings → Calendar →
//  "Show where each field goes"); the Calendar row's mark always shows.
//  Editors open inside the list under their row, one at a time.
// ─────────────────────────────────────────────────────────────────────────────

import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ReadAsLine } from '../../../features/items/components/ReadAsLine'
import { effectiveGoogleTarget, hasGoogleTasks } from '../../../features/items/sheetRules'
import type { GoogleTarget } from '../../../features/items/itemTypes'
import { AlertRows, ShowAsRow, TravelRow, UrlRow } from './CalendarFieldRows'
import { FieldMark, MarkHost } from './FieldMark'
import { FilledMark, FilledRows } from './FillMark'
import { cx } from '../../ui'
import { LINE, Section } from './ItemRows'
import { CalendarRow, GoogleListRow } from './OptionsSection'
import { PlaceRow } from './PlaceRow'
import { PlanningSection } from './PlanningSection'
import { TimeSection, type PanelKey } from './TimeSection'
import { fieldGoes, screenParts, type ScreenField } from './itemScreenRules'
import { isScheduleFieldHidden, isTaskFieldHidden, type RepeatAnchor } from './planModal.config'
import { shapeOf, withCalendarField, type PlanForm } from './planForm'
import type { PlanModalConfig } from './planModal.types'
import type { QuickAddResult } from '../../../features/items/quickAdd'

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
  /** The Calendar row's choice can be shown: Google is connected here, or the item's area is on Apple Calendar. */
  googleConnected: boolean
  /** Where the item's calendar event lives (the server's rule, worked out by the sheet). */
  calendarApp: 'google' | 'apple'
  /** Where an edit stays when this device can't show the choice (its saved target). */
  keptTarget?: GoogleTarget
  /** A repeating item opened on one of its days (its This day | All days is in the header). */
  occurrenceDate?: string | null
  /** Editing: a saved one-off doesn't turn into a repeat here, nor a saved repeat into a one-off. */
  savedKind?: 'one-off' | 'repeat'
  /** Editing a repeat: its saved start and what it counts from. */
  savedRepeat?: { start: string; anchor: RepeatAnchor | null }
  /** Editing an item with a day and time: the zone it was saved in (183; null = the home zone). */
  savedZone?: string | null
  exceptDates?: readonly string[]
  /** Settings → Calendar → "Show where each field goes". */
  showMarks: boolean
  /** Apple Calendar's notes carry the item's notes (Settings → Calendar → Every Apple Calendar event). */
  appleNotes: boolean
  /** Apple refused the item: why (the Calendar row's red dot), or null. */
  refused: string | null
  /** The item's own rows, left out of the timeline's "other things". */
  own: { blockId?: string | null; scheduleBlockId?: string | null }
  /** An edit: the last group's "Delete Item". */
  onDelete?: () => void
  deleting?: boolean
  /** Why the typed link can't be saved (planForm.urlProblem), or null. */
  urlIssue: string | null
  /** Why the End Repeat can't be saved (planForm.repeatEndIssue), or null. */
  endIssue: string | null
  /** ✨ (ItemFill.tsx): its button beside the title, its field or review line under it, the rows it filled. */
  fill?: { button: ReactNode; panel: ReactNode; rows: ReadonlySet<string> }
}

/** What "Default" means on the Alert row where the item goes (193: null = the area's alert in Apple Calendar,
 *  Google Calendar's own default there; nothing when it stays in the app). */
const DEFAULT_ALERT_HINT: Partial<Record<ReturnType<typeof fieldGoes>, string>> = {
  apple: "Its area's alert (Settings → Calendar)",
  'google-calendar': "Google Calendar's own default",
}

export function ItemForm({
  form, patch, config, typed, onTitle, parse, onKeepText, creating, today, nextTime, googleConnected, calendarApp, keptTarget,
  occurrenceDate, savedKind, savedRepeat, savedZone, exceptDates, showMarks, appleNotes, refused, own, onDelete, deleting,
  urlIssue, endIssue, fill,
}: Props) {
  const titleId = useId()
  const [open, setOpen] = useState<PanelKey | null>(null)
  const toggle = (k: PanelKey | null) => setOpen(o => (k === null || o === k ? null : k))
  const hideTask = (f: Parameters<typeof isTaskFieldHidden>[0]) => isTaskFieldHidden(f, config)
  const shape = shapeOf(form)
  const target = effectiveGoogleTarget(shape, form.googlePick)
  // Its area on Apple Calendar (Settings → Calendar, 2b-2): the row says where the event really goes.
  // A place and the calendar fields belong to a slot or a repeat (186, 193): a time, a repeat, or all day on a calendar.
  const { day, repeating, showGoogle, slotFields } = screenParts(form, {
    occurrenceDate, choiceShown: googleConnected, calendarHidden: isScheduleFieldHidden('gcal', config), target,
  })
  // Labels are a task's (180): a repeat's rule has none — its days are tasks the database makes — and a repeat's
  // day opened here ("This day") isn't loaded with its task's labels, so it doesn't show them.
  const showLabels = !repeating && !day && !hideTask('labels')
  // A category belongs to a slot or a repeat: only an item with a time or a repeat has one.
  const showCategory = !!form.time || repeating
  // A repeat's days go to the default list (156 stores no list per repeat).
  const showList = showGoogle && hasGoogleTasks(target) && !repeating && !hideTask('googleList')
  const marksTarget = showGoogle ? target : (keptTarget ?? 'none')
  const goes = (f: ScreenField) => fieldGoes(f, { target: marksTarget, calendarApp, dated: !!form.date || repeating, appleNotes })
  const showNotes = !hideTask('notes')
  const hasPin = form.place?.lat !== undefined && form.place?.lon !== undefined

  return (
    <FilledRows rows={fill?.rows}><MarkHost on={showMarks}>
      <div className="flex flex-col gap-4 pb-1">
        <Section>
          <div className="flex items-start gap-2 px-3.5 py-2">
            <label htmlFor={titleId} className="sr-only">Title</label>
            <TitleField id={titleId} value={typed} onChange={onTitle} autoFocus={creating}
              placeholder={creating ? 'e.g. Gym 17:30 1h every Mon Wed Fri' : 'Title'} />
            {fill?.button}
            <FieldMark goes={goes('title')} className="mt-1.5" />
          </div>
          {fill?.panel}
          {parse && <div className="px-3.5 pb-2"><ReadAsLine parse={parse} start={form.date ?? today} onKeepText={onKeepText} /></div>}
        </Section>

        {slotFields && (
          <Section title="Location">
            <PlaceRow value={form.place} onChange={place => patch({ place, placeTouched: true })}
              mark={<><FilledMark row="Location" /><FieldMark goes={goes('place')} /></>} />
            <TravelRow minutes={form.travelMinutes} hasPin={hasPin} open={open} toggle={toggle} mark={<FieldMark goes={goes('travel')} />}
              onChange={travelMinutes => patch(withCalendarField(form, 'travelMinutes', travelMinutes))} />
          </Section>
        )}

        <Section title="Time">
          <TimeSection
            form={form} patch={patch} open={open} toggle={toggle} today={today} nextTime={nextTime} config={config}
            occurrenceDate={occurrenceDate} savedKind={savedKind} savedRepeat={savedRepeat} savedZone={savedZone}
            exceptDates={exceptDates} target={target} goes={goes} own={own} endIssue={endIssue}
          />
        </Section>

        {(showGoogle || slotFields) && (
          <Section title="Options">
            {showGoogle && (
              <CalendarRow shape={shape} target={target} app={calendarApp} dated={!!form.date || repeating} refused={refused}
                open={open} toggle={toggle} onPick={googlePick => patch({ googlePick })} />
            )}
            {showList && (
              <GoogleListRow
                value={form.googleListTitle} typing={form.shown.includes('list')} open={open} toggle={toggle}
                mark={<FieldMark goes={goes('list')} />}
                onPick={googleListTitle => patch({ googleListTitle, shown: form.shown.filter(r => r !== 'list') })}
                onNew={() => patch({ googleListTitle: '', shown: [...form.shown.filter(r => r !== 'list'), 'list'] })}
                onType={googleListTitle => patch({ googleListTitle })}
                onDone={() => patch({ shown: form.shown.filter(r => r !== 'list') })}
              />
            )}
            {slotFields && (
              <>
                <AlertRows alerts={form.alerts} allDay={!form.time} defaultHint={DEFAULT_ALERT_HINT[goes('alerts')]} open={open} toggle={toggle}
                  mark={<FieldMark goes={goes('alerts')} />} onChange={alerts => patch(withCalendarField(form, 'alerts', alerts))} />
                <ShowAsRow showAs={form.showAs} timedWithLength={!!form.time && !!form.duration} mark={<FieldMark goes={goes('showAs')} />}
                  onChange={showAs => patch(withCalendarField(form, 'showAs', showAs))} />
              </>
            )}
          </Section>
        )}

        {(showNotes || slotFields) && (
          <Section title="Details">
            {slotFields && (
              <UrlRow url={form.url} problem={urlIssue} open={open} toggle={toggle}
                mark={<><FilledMark row="URL" /><FieldMark goes={goes('url')} /></>}
                onChange={url => patch(withCalendarField(form, 'url', url))} />
            )}
            {showNotes && <NotesField value={form.notes} onChange={notes => patch({ notes })}
              mark={<><FilledMark row="Notes" className="mt-3" /><FieldMark goes={goes('notes')} className="mt-3" /></>} />}
          </Section>
        )}

        <Section title="Planning">
          <PlanningSection form={form} patch={patch} open={open} toggle={toggle} config={config} today={today}
            showCategory={showCategory} showLabels={showLabels} goes={goes} />
        </Section>

        {onDelete && (
          <Section>
            <button type="button" onClick={onDelete} disabled={deleting}
              className="flex min-h-11 w-full items-center justify-center px-3.5 text-lead font-medium text-danger transition-colors hover:bg-surface-hover disabled:opacity-50">
              Delete Item
            </button>
          </Section>
        )}
      </div>
    </MarkHost></FilledRows>
  )
}

/** A field that grows with its text (a long title, notes); `oneLine`: Enter adds no line break. */
function useGrow(value: string) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    // + the border (an underline), which scrollHeight leaves out.
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`
  }, [value])
  return ref
}

function TitleField({ id, value, onChange, autoFocus, placeholder }: {
  id: string
  value: string
  onChange: (text: string) => void
  autoFocus: boolean
  placeholder: string
}) {
  const ref = useGrow(value)
  return (
    <textarea
      ref={ref} id={id} rows={1} value={value} autoFocus={autoFocus} data-autofocus={autoFocus || undefined} placeholder={placeholder}
      onChange={e => onChange(e.target.value.replace(/\s*\n+\s*/g, ' '))}
      onKeyDown={e => { if (e.key === 'Enter') e.preventDefault() }}
      autoComplete="off" enterKeyHint="done"
      className="input-bare min-w-0 flex-1 resize-none overflow-hidden border-b-0 pb-0 text-title font-semibold placeholder:font-normal"
    />
  )
}

/** Notes, with no box: the row is the field. */
function NotesField({ value, onChange, mark }: { value: string; onChange: (v: string) => void; mark: ReactNode }) {
  const ref = useGrow(value)
  return (
    <div className={cx(LINE, 'flex items-start gap-2 px-3.5')}>
      <textarea ref={ref} rows={2} value={value} onChange={e => onChange(e.target.value)} placeholder="Notes" aria-label="Notes"
        className="input-bare min-w-0 flex-1 resize-none overflow-hidden border-b-0 py-2.5 text-lead" />
      {mark}
    </div>
  )
}
