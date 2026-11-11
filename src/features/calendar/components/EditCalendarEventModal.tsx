import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ExternalLink } from 'lucide-react'
import { ModalShell, confirmDelete } from '../../../shared/modals'
import { Button } from '../../../shared/ui'
import { DateCalendar } from '../../../shared/components/DateCalendar'
import { FieldMark, MarkHost } from '../../../shared/components/plan-modal/FieldMark'
import { NoteRow, Panel, Pill, Row, Section, ToggleRow, LINE } from '../../../shared/components/plan-modal/ItemRows'
import { TimeWheel } from '../../../shared/components/plan-modal/TimeWheel'
import { displayDate, LOCAL_TZ } from '../../../shared/components/plan-modal/planModal.config'
import { CalendarApiError } from '../api/calendarApi'
import { useCalendarList, useDeleteCalendarEvent, useUpdateCalendarEvent } from '../hooks/useCalendar'
import {
  eventEditAccess, eventEditDraft, eventEditProblem, eventEditTimes, eventTimesChanged, type EventEditDraft,
} from '../eventEditRules'
import type { CalendarEvent } from '../types'

interface Props {
  event:   CalendarEvent
  onClose: () => void
}

type Opened = 'sDate' | 'sTime' | 'eDate' | 'eTime' | null

/** A missing write permission (the scope), as Google's 403 names it — never a guess from the message alone. */
function needsWriteScope(err: unknown): boolean {
  return err instanceof CalendarApiError && err.status === 403
    && /insufficient(Permissions|Scope)|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(JSON.stringify(err.body ?? {}))
}

/** The event's own page on Google (its `htmlLink`, from Google's answer): only an https link to Google Calendar's
 *  own host, as the URL parser reads it — anything else isn't offered. */
function googleCalendarLink(raw: string | null | undefined): string | null {
  if (!raw) return null
  try {
    const u = new URL(raw)
    return u.protocol === 'https:' && (u.hostname === 'www.google.com' || u.hostname === 'calendar.google.com') ? u.href : null
  } catch { return null }
}

const GOOGLE = <FieldMark always goes="google-calendar" />
const FIELD = 'input-bare min-w-0 flex-1 resize-none overflow-hidden border-b-0'

/**
 * Edit or delete one event made in Google Calendar itself (owner, 16.10.2026: an all-day one "can't be edited and
 * there are no options to mark as all day"), drawn as the item screen (step 3 of docs/features/item-screen-plan.md:
 * one screen for every kind) — the title with no box, Time (All-day, Starts and Ends, each a day and a time pill; a
 * month or a wheel opens in the list), Options → Calendar, Details → Notes, Delete Event. Its data path is its own, as
 * before: a Google event, not an app item — Save sends one PATCH (title, the description when changed, the times when
 * changed; eventEditRules clears the date form it doesn't use). An event the app may not change (a calendar you only
 * view, an invitation, a birthday, a locked copy) shows its rows read-only, says why and opens in Google Calendar. The
 * hooks toast the result.
 */
export function EditCalendarEventModal({ event, onClose }: Props) {
  const calendarId = event.calendarId ?? 'primary'
  const { data: calendars } = useCalendarList()
  const calendar = calendars?.find(c => c.id === calendarId)
  const access = eventEditAccess(event, calendar?.accessRole)
  // The event's own zone (it may have been made elsewhere); the device's when it names none.
  const zone = event.start.timeZone ?? LOCAL_TZ
  const [initial] = useState(() => eventEditDraft(event, zone))
  const [draft, setDraft] = useState<EventEditDraft>(initial)
  const [title, setTitle] = useState(event.summary ?? '')
  const [desc, setDesc] = useState(event.description ?? '')
  const [open, setOpen] = useState<Opened>(null)
  const toggle = (k: Opened) => setOpen(o => (k === null || o === k ? null : k))
  const set = (patch: Partial<EventEditDraft>) => setDraft(d => ({ ...d, ...patch }))

  const update = useUpdateCalendarEvent()
  const remove = useDeleteCalendarEvent()
  const isPending = update.isPending || remove.isPending
  const problem = eventEditProblem(draft)
  const reconnect = needsWriteScope(update.error) || needsWriteScope(remove.error)
  const canEdit = access.canEdit
  const googleLink = googleCalendarLink(event.htmlLink)

  async function handleSave() {
    if (!title.trim() || problem) return
    const patch: Record<string, unknown> = { summary: title.trim() }
    if (desc !== (event.description ?? '')) patch.description = desc
    if (eventTimesChanged(initial, draft)) Object.assign(patch, eventEditTimes(draft, zone))
    try {
      await update.mutateAsync({ calendarId, eventId: event.id, patch })
      onClose()
    } catch { /* toasted by the hook */ }
  }

  async function handleDelete() {
    const result = await confirmDelete({
      title: 'Delete this event?',
      message: 'It is removed from Google Calendar. This can\'t be undone.',
      remove: () => remove.mutateAsync({ calendarId, eventId: event.id }),
      done: 'Event deleted',
    })
    if (result === 'deleted') onClose()
  }

  // A pill opens its editor only where the event may be changed.
  const pill = (k: Exclude<Opened, null>, label: string, value: string, wide = false) => (
    <Pill wide={wide} label={label} open={open === k} disabled={!canEdit} onClick={() => toggle(k)}>{value}</Pill>
  )
  // All day: the last day it covers (inclusive); with a time, the day it ends.
  const startDay = (d: string) => set({ startDate: d, endDate: draft.endDate < d ? d : draft.endDate })

  return (
    <ModalShell
      onClose={onClose} title={canEdit ? 'Edit Item' : (event.summary || 'Event')} subtitle={canEdit ? 'Google Calendar · Save sends it' : 'Google Calendar'}
      size="md" compact grouped dismissible={!isPending} bodyClassName="px-3 pb-4 pt-1.5 sm:px-4"
      headerActions={canEdit ? (
        <Button variant="primary" size="sm" onClick={() => { void handleSave() }} loading={update.isPending}
          disabled={isPending || !title.trim() || !!problem} className="min-w-[4.5rem]">
          Save
        </Button>
      ) : undefined}
    >
      <MarkHost on>
        <div className="flex flex-col gap-4 pb-1">
          <Section>
            <div className="flex items-start gap-2 px-3.5 py-2">
              <input
                aria-label="Title" value={title} onChange={e => setTitle(e.target.value)} placeholder="Title" readOnly={!canEdit}
                autoFocus={canEdit} className={`${FIELD} pb-0 text-title font-semibold placeholder:font-normal`}
              />
              <FieldMark always goes="google-calendar" className="mt-1.5" />
            </div>
          </Section>

          <Section title="Time">
            {canEdit && access.allDayAllowed && (
              <ToggleRow label="All-day" mark={GOOGLE} on={draft.allDay} onChange={on => { toggle(null); set({ allDay: on }) }} />
            )}
            <Row label="Starts" mark={GOOGLE}>
              <span className="flex shrink-0 gap-1.5">
                {pill('sDate', `Starts on ${displayDate(draft.startDate)} — change the day`, displayDate(draft.startDate), true)}
                {!draft.allDay && pill('sTime', `Starts at ${draft.startTime} — change the time`, draft.startTime)}
              </span>
            </Row>
            {open === 'sDate' && (
              <Panel label="The day it starts">
                <div className="flex justify-center"><DateCalendar compact value={draft.startDate} onPick={d => { startDay(d); toggle(null) }} /></div>
              </Panel>
            )}
            {open === 'sTime' && (
              <Panel label="The time it starts"><TimeWheel label="Starts" value={draft.startTime} onChange={startTime => set({ startTime })} /></Panel>
            )}
            <Row label={draft.allDay ? 'Last day' : 'Ends'} mark={GOOGLE}>
              <span className="flex shrink-0 gap-1.5">
                {pill('eDate', `${draft.allDay ? 'Last day' : 'Ends on'} ${displayDate(draft.endDate)} — change the day`, displayDate(draft.endDate), true)}
                {!draft.allDay && pill('eTime', `Ends at ${draft.endTime} — change the time`, draft.endTime)}
              </span>
            </Row>
            {open === 'eDate' && (
              <Panel label="The day it ends">
                <div className="flex justify-center">
                  <DateCalendar compact value={draft.endDate} min={draft.startDate} onPick={endDate => { set({ endDate }); toggle(null) }} />
                </div>
              </Panel>
            )}
            {open === 'eTime' && (
              <Panel label="The time it ends"><TimeWheel label="Ends" value={draft.endTime} onChange={endTime => set({ endTime })} /></Panel>
            )}
            {problem && <NoteRow tone="danger">{problem}</NoteRow>}
            {/* Google's recurring-events guide: an instance changed by its own id is an exception — that day only. */}
            {event.recurringEventId && canEdit && <NoteRow>A repeating event: this changes this day only.</NoteRow>}
          </Section>

          <Section title="Options">
            <Row label="Calendar" mark={GOOGLE}>
              <span className="min-w-0 truncate text-fg-2">{calendar?.summary && calendarId !== 'primary' ? calendar.summary : 'Google Calendar'}</span>
            </Row>
            {!canEdit && <NoteRow>{access.reason} It can&apos;t be changed here.</NoteRow>}
          </Section>

          {(canEdit || event.description) && (
            <Section title="Details">
              <NotesRow value={desc} onChange={setDesc} readOnly={!canEdit} mark={<FieldMark always goes="google-calendar" className="mt-3" />} />
            </Section>
          )}

          {reconnect && (
            <p data-tone="danger" className="tone-text px-3.5 text-meta">
              Google Calendar needs edit permission. Reconnect it in{' '}
              <Link to="/settings?tab=subscriptions" onClick={onClose} className="font-semibold underline">Settings → Subscriptions</Link>.
            </p>
          )}

          {(!canEdit && googleLink) || access.canDelete ? (
            <Section>
              {!canEdit && googleLink && (
                <a href={googleLink} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"
                  className={`${LINE} flex min-h-11 w-full items-center gap-1.5 px-3.5 text-lead font-medium text-accent-600 hover:bg-surface-hover`}>
                  <ExternalLink aria-hidden className="h-4 w-4" />Open in Google Calendar
                </a>
              )}
              {access.canDelete && (
                <button type="button" onClick={() => { void handleDelete() }} disabled={isPending}
                  className={`${LINE} flex min-h-11 w-full items-center justify-center px-3.5 text-lead font-medium text-danger transition-colors hover:bg-surface-hover disabled:opacity-50`}>
                  Delete Event
                </button>
              )}
            </Section>
          ) : null}
        </div>
      </MarkHost>
    </ModalShell>
  )
}

/** The description, with no box: the row is the field. */
function NotesRow({ value, onChange, readOnly, mark }: { value: string; onChange: (v: string) => void; readOnly: boolean; mark: ReactNode }) {
  return (
    <div className="flex items-start gap-2 px-3.5">
      <textarea rows={3} value={value} onChange={e => onChange(e.target.value)} readOnly={readOnly} placeholder="Notes" aria-label="Notes"
        className={`${FIELD} py-2.5 text-lead`} />
      {mark}
    </div>
  )
}
