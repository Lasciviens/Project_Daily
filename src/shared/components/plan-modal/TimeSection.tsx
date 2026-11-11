// ─────────────────────────────────────────────────────────────────────────────
//  The item screen's Time group (owner's points 1–4):
//    Date        a switch (off = no date: Inbox) — not for a repeat or its day
//    All-day     a switch (on = no time: an all-day event on a calendar, else a
//                plain day)
//    Starts      [Tue 10.11.2026] [17:30]   — a month / a wheel opens below
//    Ends        [Tue 10.11.2026] [18:30]   — its own day: the next day too
//    the day's timeline (drag the item, drag its ends)
//    Time Zone   only when the item's clock isn't the phone's (183)
//    Repeat      Never / Weekly · Mon, Wed — today's choices with the day
//                bubbles, and the next dates
//    End Repeat  Never / On a day / After N times (193, EndRepeatRows)
//  Stored as before: a day, a start and a length (itemScreenRules).
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from 'react'
import { DateCalendar } from '../DateCalendar'
import { RecurrenceField } from './fields'
import { AllDayBand, DayTimeline } from './DayTimeline'
import { EndRepeatRows } from './EndRepeatRows'
import { TimeWheel } from './TimeWheel'
import { FieldMark } from './FieldMark'
import { ChoiceRow, NoteRow, Panel, Pill, Row, TapRow, ToggleRow } from './ItemRows'
import { chipClass } from './fieldStyles'
import { sectionForItem } from '../../../features/items/sheetRules'
import { addDaysIso } from '../../../features/daily/recurrence'
import { itemTimeZone, SERVER_EVENT_TIME_ZONE } from '../../../features/calendar/calendarEventRules'
import { phoneTimeZone, sameClock, zoneCity } from '../../utils/timeZone'
import type { GoogleTarget } from '../../../features/items/itemTypes'
import {
  displayDate, isScheduleFieldHidden, recurrenceProblem, repeatAnchorOf, repeatPreview, withStartForRepeatChange,
  RECURRENCE_OPTIONS, RECURRING_EDIT_OPTIONS, type RepeatAnchor,
} from './planModal.config'
import { withAllDaySwitch, withCalendarField, withDate, withEnd, type PlanForm } from './planForm'
import { END_PROBLEM_TEXT, endOf, endOnWheel, minutesOf, timeOfMinutes, type FieldGoes, type ScreenField } from './itemScreenRules'
import type { TaskSection } from '../../../features/todo/types'
import type { PlanModalConfig } from './planModal.types'

export type PanelKey =
  | 'sDate' | 'sTime' | 'eDate' | 'eTime' | 'zone' | 'repeat'
  | 'calendar' | 'list' | 'category' | 'deadline' | 'dTime' | 'window'
  | 'repeatEnd' | 'alert' | 'alert2' | 'travel' | 'link' | 'waiting' | 'parent'

const SECTION_LABEL = { inbox: 'Inbox', today: 'Today', backlog: 'Backlog' } as const

/**
 * The zone row (183): shown when the item's times are on another clock than the phone's ("Oslo time" on an item made
 * at home, opened in Istanbul) or while the phone is away from the home clock, so a time typed abroad can still be put
 * on Oslo's. It offers the item's own zone, this phone's and the home zone (one per clock); the times stay as typed.
 */
function zoneChoices(zone: string | null, savedZone: string | null | undefined) {
  const phone = phoneTimeZone()
  if (!phone) return null
  const current = itemTimeZone(zone)
  const saved = savedZone === undefined ? null : itemTimeZone(savedZone)
  const abroad = !sameClock(phone, SERVER_EVENT_TIME_ZONE)
  if (!abroad && sameClock(current, phone) && (!saved || sameClock(saved, phone))) return null
  const choices: string[] = []
  for (const z of [saved, phone, SERVER_EVENT_TIME_ZONE]) {
    if (z && !choices.some(c => sameClock(c, z))) choices.push(z)
  }
  return { phone, current, choices }
}

export function TimeSection({
  form, patch, open, toggle, today, nextTime, config, occurrenceDate, savedKind, savedRepeat, savedZone, exceptDates,
  target, goes, own, endIssue, savedSection,
}: {
  form: PlanForm
  patch: (p: Partial<PlanForm>) => void
  open: PanelKey | null
  toggle: (k: PanelKey | null) => void
  today: string
  nextTime: string
  config?: PlanModalConfig
  occurrenceDate?: string | null
  savedKind?: 'one-off' | 'repeat'
  savedRepeat?: { start: string; anchor: RepeatAnchor | null }
  savedZone?: string | null
  exceptDates?: readonly string[]
  target: GoogleTarget
  goes: (f: ScreenField) => FieldGoes
  own: { blockId?: string | null; scheduleBlockId?: string | null }
  /** Why the End Repeat can't be saved (planForm.repeatEndIssue), or null. */
  endIssue: string | null
  /** An edit's task section: an undated task keeps it (Inbox or Backlog — the save's own rule). */
  savedSection?: TaskSection | null
}) {
  const day = !!occurrenceDate && form.scope === 'day'
  const repeating = form.recurrence !== 'none' && !day
  const pickingDates = repeating && form.recurrence === 'custom' && form.customKind === 'dates'
  // A saved repeat shows its start only for a choice that counts from it (Monthly, every N).
  const showDate = !pickingDates && (savedKind !== 'repeat' || day || repeatAnchorOf(form) !== null)
  const canRepeat = !day && savedKind !== 'one-off' && !isScheduleFieldHidden('recurrence', config)
  const allowNoDate = !repeating && !day
  const date = form.date ?? today
  const dated = !!form.date || repeating
  // The day goes where the item goes (a Google Task too); its time of day only to a calendar.
  const timeMark = <FieldMark goes={goes('time')} />
  const clockMark = <FieldMark goes={goes('clock')} />
  const filedUnder = SECTION_LABEL[sectionForItem({ date: form.date }, today, savedSection)]

  const length = form.duration
  const end = form.badEnd ?? (form.time && length ? endOf(date, form.time, length) : null)
  const crosses = !!end && end.date !== date
  const preview = repeating ? repeatPreview(form, date, today, exceptDates, form.repeatEnd) : null
  const timelineDay = repeating ? preview?.next[0] ?? null : form.date
  const zone = form.time ? zoneChoices(form.timeZone, savedZone) : null

  // A switch turned back gives back what it took: an edit saves at once, so a stray tap must lose nothing.
  const [heldDay, setHeldDay] = useState<Pick<PlanForm, 'date' | 'time' | 'duration' | 'googlePick'> | null>(null)
  const [heldTime, setHeldTime] = useState<Pick<PlanForm, 'duration' | 'alerts' | 'calendarTouched'> & { time: string } | null>(null)

  const onRepeat = (p: Partial<PlanForm>) =>
    patch(savedRepeat && savedKind === 'repeat' ? withStartForRepeatChange(form, p, savedRepeat, today) : p)

  return (
    <>
      {allowNoDate && (
        <ToggleRow label="Date" mark={timeMark} on={!!form.date} note={filedUnder}
          onChange={on => {
            toggle(null)
            if (on) { patch(heldDay ?? { date: today }); return }
            setHeldDay({ date: form.date, time: form.time, duration: form.duration, googlePick: form.googlePick })
            // No day: no calendar either (Google Calendar needs a day) — the default takes over.
            patch({ ...withDate(null), badEnd: null, ...(target === 'calendar' || target === 'both' ? { googlePick: null } : {}) })
          }} />
      )}
      {dated && (
        <>
          <ToggleRow label="All-day" mark={clockMark} on={!form.time}
            onChange={on => {
              toggle(null)
              if (on && form.time) setHeldTime({ time: form.time, duration: form.duration, alerts: form.alerts, calendarTouched: form.calendarTouched })
              patch(!on && heldTime ? { ...heldTime, badEnd: null } : withAllDaySwitch(form, on, target, nextTime))
            }} />

          <Row label="Starts" mark={form.time ? clockMark : timeMark}>
            <span className="flex shrink-0 gap-1.5">
              {showDate && (
                <Pill wide label={`Starts on ${displayDate(date)} — change the day`} open={open === 'sDate'} onClick={() => toggle('sDate')}>
                  {displayDate(date)}
                </Pill>
              )}
              {form.time && (
                <Pill label={`Starts at ${form.time} — change the time`} open={open === 'sTime'} onClick={() => toggle('sTime')}>{form.time}</Pill>
              )}
            </span>
          </Row>
          {open === 'sDate' && showDate && (
            <Panel label="The day it starts">
              <div className="flex flex-col items-center gap-1">
                <DateCalendar compact value={date} onPick={d => { patch({ ...withDate(d), badEnd: null }); toggle(null) }} />
                {allowNoDate && <p className="text-meta text-fg-muted">Goes to {filedUnder}</p>}
              </div>
            </Panel>
          )}
          {open === 'sTime' && form.time && (
            <Panel label="The time it starts">
              <TimeWheel label="Starts" value={form.time} onChange={time => patch({ time, badEnd: null })} />
            </Panel>
          )}

          {form.time && (
            <Row label="Ends" mark={clockMark}>
              <span className="flex shrink-0 items-center gap-1.5">
                {end ? (
                  <>
                    {showDate ? (
                      <Pill wide label={`Ends on ${displayDate(end.date)} — change the day`} open={open === 'eDate'} onClick={() => toggle('eDate')}
                        bad={!!form.badEnd && form.badEnd.date !== date}>
                        {displayDate(end.date)}
                      </Pill>
                    ) : crosses && <span className="text-meta text-fg-muted">next day</span>}
                    <Pill label={`Ends at ${end.time} — change the time`} open={open === 'eTime'} onClick={() => toggle('eTime')} bad={!!form.badEnd}>
                      {end.time}
                    </Pill>
                  </>
                ) : (
                  <Pill label="No end: it doesn't block time — add an end" onClick={() => { patch({ duration: 60 }); toggle('eTime') }}>None</Pill>
                )}
              </span>
            </Row>
          )}
          {form.badEnd && <NoteRow tone="danger">{END_PROBLEM_TEXT[form.badEnd.problem]} — nothing is saved until it's fixed.</NoteRow>}
          {open === 'eDate' && end && showDate && (
            <Panel label="The day it ends">
              <div className="flex justify-center">
                <DateCalendar compact value={end.date} min={date} max={addDaysIso(date, 1)}
                  onPick={d => { patch(withEnd(form, { date: d, time: end.time })); toggle(null) }} />
              </div>
            </Panel>
          )}
          {open === 'eTime' && end && (
            <Panel label="The time it ends">
              {/* No day shown (a saved weekly repeat): an end at or before the start is the next day. */}
              <TimeWheel label="Ends" value={end.time}
                onChange={time => patch(withEnd({ date, time: form.time }, endOnWheel(showDate ? end.date : date, form.time ?? time, time, showDate)))} />
              <div className="flex justify-center">
                <button type="button" onClick={() => { patch({ duration: null, badEnd: null }); toggle(null) }} className={chipClass('remove')}>
                  No end · doesn&apos;t block time
                </button>
              </div>
            </Panel>
          )}

          {timelineDay && (
            <div className="relative before:absolute before:left-3.5 before:right-0 before:top-0 before:h-px before:bg-line">
              {form.time ? (
                <DayTimeline
                  day={timelineDay} start={minutesOf(form.time)} length={length}
                  own={own} locked={!!form.badEnd} dayNote={repeating ? `Next ${displayDate(timelineDay)}` : undefined}
                  onChange={(start, len) => patch({ time: timeOfMinutes(start), duration: len, badEnd: null })}
                />
              ) : (
                <AllDayBand day={timelineDay} own={own} dayNote={repeating ? `Next ${displayDate(timelineDay)}` : undefined} />
              )}
            </div>
          )}

          {zone && (
            <>
              <TapRow label="Time Zone" mark={clockMark} value={`${zoneCity(zone.current)} time`} open={open === 'zone'} onClick={() => toggle('zone')} />
              {open === 'zone' && (
                <Panel label="Time zone">
                  {zone.choices.map(c => (
                    <ChoiceRow key={c} label={`${zoneCity(c)} time${c === zone.phone ? ' · this phone' : ''}`} chosen={sameClock(c, zone.current)}
                      onClick={() => { patch({ timeZone: c }); toggle(null) }} />
                  ))}
                </Panel>
              )}
            </>
          )}

          {(canRepeat || repeating) && !day && (
            <>
              <TapRow label="Repeat" mark={<FieldMark goes={goes('repeat')} />} open={open === 'repeat'} onClick={() => toggle('repeat')}
                value={!repeating ? 'Never' : preview?.summary ?? recurrenceProblem(form) ?? 'Repeats'}
                tone={repeating && !preview ? 'warn' : undefined} />
              {open === 'repeat' && (
                <Panel label="Repeat">
                  <RecurrenceField
                    value={form} onChange={onRepeat} start={date} exceptDates={exceptDates} alwaysPreview end={form.repeatEnd}
                    options={savedKind === 'repeat' ? RECURRING_EDIT_OPTIONS : RECURRENCE_OPTIONS}
                  />
                </Panel>
              )}
              {repeating && (
                <EndRepeatRows
                  form={form} end={form.repeatEnd} start={date} today={today} exceptDates={exceptDates} problem={endIssue}
                  onChange={repeatEnd => patch(withCalendarField(form, 'repeatEnd', repeatEnd))}
                  mark={<FieldMark goes={goes('repeatEnd')} />} open={open} toggle={toggle}
                />
              )}
            </>
          )}
        </>
      )}
    </>
  )
}
