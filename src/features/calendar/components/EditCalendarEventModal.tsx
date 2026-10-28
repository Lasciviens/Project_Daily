import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ExternalLink } from 'lucide-react'
import { ModalShell, confirmDelete } from '../../../shared/modals'
import { Button, SegmentedControl } from '../../../shared/ui'
import { DateInput } from '../../../shared/components/DateInput'
import { Time24Field } from '../../../shared/components/plan-modal/fields'
import { LOCAL_TZ, shiftTime } from '../../../shared/components/plan-modal/planModal.config'
import { formatWeekdayDate } from '../../../shared/utils/dateFormat'
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

const KINDS: { value: 'timed' | 'allDay'; label: string }[] = [
  { value: 'timed', label: 'At a time' },
  { value: 'allDay', label: 'All day' },
]

/** A missing write permission (the scope), as Google's 403 names it — never a guess from the message alone. */
function needsWriteScope(err: unknown): boolean {
  return err instanceof CalendarApiError && err.status === 403
    && /insufficient(Permissions|Scope)|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(JSON.stringify(err.body ?? {}))
}

/**
 * Edit or delete one event made in Google Calendar itself (owner, 16.10.2026:
 * an all-day one "can't be edited and there are no options to mark as all
 * day"). All day or at a time, its days and times (eventEditRules), title and
 * description; a PATCH clears the date form it doesn't use. An event the app
 * may not change (a calendar you only view, an invitation, a birthday, a
 * locked copy) says why and opens in Google Calendar. The hooks toast the result.
 */
export function EditCalendarEventModal({ event, onClose }: Props) {
  const calendarId = event.calendarId ?? 'primary'
  const { data: calendars } = useCalendarList()
  const access = eventEditAccess(event, calendars?.find(c => c.id === calendarId)?.accessRole)
  // The event's own zone (it may have been made elsewhere); the device's when it names none.
  const zone = event.start.timeZone ?? LOCAL_TZ
  const [initial] = useState(() => eventEditDraft(event, zone))
  const [draft, setDraft] = useState<EventEditDraft>(initial)
  const [title, setTitle] = useState(event.summary ?? '')
  const [desc, setDesc] = useState(event.description ?? '')
  const set = (patch: Partial<EventEditDraft>) => setDraft(d => ({ ...d, ...patch }))

  const update = useUpdateCalendarEvent()
  const remove = useDeleteCalendarEvent()
  const isPending = update.isPending || remove.isPending
  const problem = eventEditProblem(draft)
  const reconnect = needsWriteScope(update.error) || needsWriteScope(remove.error)

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
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
      message: 'It is removed from Google Calendar.',
      remove: () => remove.mutateAsync({ calendarId, eventId: event.id }),
      done: 'Event deleted',
    })
    if (result === 'deleted') onClose()
  }

  if (!access.canEdit) {
    const when = initial.allDay
      ? initial.endDate === initial.startDate ? `${formatWeekdayDate(initial.startDate)} · all day` : `${formatWeekdayDate(initial.startDate)} – ${formatWeekdayDate(initial.endDate)} · all day`
      : initial.endDate === initial.startDate ? `${formatWeekdayDate(initial.startDate)} ${initial.startTime}–${initial.endTime}`
      : `${formatWeekdayDate(initial.startDate)} ${initial.startTime} – ${formatWeekdayDate(initial.endDate)} ${initial.endTime}`
    return (
      <ModalShell onClose={onClose} title={event.summary || 'Event'} subtitle="Google Calendar" size="sm"
        footer={
          <div className="flex items-center gap-2">
            {access.canDelete && (
              <Button variant="ghost" className="text-danger" onClick={handleDelete} disabled={isPending} loading={remove.isPending}>Delete</Button>
            )}
            <Button className="ml-auto" onClick={onClose}>Close</Button>
          </div>
        }>
        <div className="flex flex-col gap-3">
          <p className="text-body tabular-nums text-fg">{when}</p>
          {event.description && <p className="whitespace-pre-wrap text-body text-fg-2">{event.description}</p>}
          <p className="text-meta text-fg-muted">{access.reason} It can't be changed here.</p>
          {event.htmlLink && (
            <a href={event.htmlLink} target="_blank" rel="noreferrer noopener" className="btn-secondary btn-sm inline-flex gap-1 self-start">
              <ExternalLink aria-hidden className="h-4 w-4" />Open in Google Calendar
            </a>
          )}
        </div>
      </ModalShell>
    )
  }

  return (
    <ModalShell
      onClose={onClose}
      title="Edit event"
      subtitle="Google Calendar"
      size="sm"
      dismissible={!isPending}
      footer={
        <div className="flex items-center gap-2">
          <Button variant="ghost" className="text-danger" onClick={handleDelete} disabled={isPending} loading={remove.isPending}>
            Delete
          </Button>
          <div className="ml-auto flex gap-2">
            <Button onClick={onClose} disabled={isPending}>Cancel</Button>
            <Button variant="primary" type="submit" form="edit-calendar-event" loading={update.isPending} disabled={isPending || !title.trim() || !!problem}>
              Save
            </Button>
          </div>
        </div>
      }
    >
      <form id="edit-calendar-event" onSubmit={handleSave} className="flex flex-col gap-4">
        <div>
          <label htmlFor="cal-event-title" className="field-label">Title</label>
          <input
            id="cal-event-title" autoFocus type="text" value={title}
            onChange={e => setTitle(e.target.value)} placeholder="Event title" className="input w-full"
          />
        </div>

        {access.allDayAllowed && (
          <SegmentedControl
            size="sm" value={draft.allDay ? 'allDay' : 'timed'} options={KINDS}
            onChange={v => set({ allDay: v === 'allDay' })}
          />
        )}

        {draft.allDay ? (
          <div className="grid grid-cols-1 gap-3 min-[416px]:grid-cols-2">
            <div>
              <span className="field-label">First day</span>
              <DateInput aria-label="First day" value={draft.startDate} className="input w-full tabular-nums"
                onChange={v => set({ startDate: v, endDate: draft.endDate < v ? v : draft.endDate })} />
            </div>
            <div>
              <span className="field-label">Last day</span>
              <DateInput aria-label="Last day" value={draft.endDate} min={draft.startDate} className="input w-full tabular-nums" onChange={v => set({ endDate: v })} />
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {/* The day beside its time from 26rem, stacked on a phone; the time picker gets the room it needs (it sizes on its own width). */}
            <div>
              <span className="field-label">Starts</span>
              <div className="flex flex-col gap-2 min-[416px]:flex-row min-[416px]:items-center">
                <DateInput aria-label="Start day" value={draft.startDate} className="input w-[10rem] tabular-nums"
                  onChange={v => set({ startDate: v, endDate: draft.endDate < v ? v : draft.endDate })} />
                <div className="min-w-0 flex-1">
                  <Time24Field value={draft.startTime} onChange={v => set({ startTime: v })} onShift={m => set({ startTime: shiftTime(draft.startTime, m) })} />
                </div>
              </div>
            </div>
            <div>
              <span className="field-label">Ends</span>
              <div className="flex flex-col gap-2 min-[416px]:flex-row min-[416px]:items-center">
                <DateInput aria-label="End day" value={draft.endDate} min={draft.startDate} className="input w-[10rem] tabular-nums" onChange={v => set({ endDate: v })} />
                <div className="min-w-0 flex-1">
                  <Time24Field value={draft.endTime} onChange={v => set({ endTime: v })} onShift={m => set({ endTime: shiftTime(draft.endTime, m) })} />
                </div>
              </div>
            </div>
          </div>
        )}
        {problem && <p data-tone="danger" className="tone-text -mt-2 text-meta">{problem}</p>}
        {/* Google's recurring-events guide: an instance changed by its own id is an exception — that day only. */}
        {event.recurringEventId && <p className="-mt-2 text-meta text-fg-muted">A repeating event: this changes this day only.</p>}

        <div>
          <label htmlFor="cal-event-desc" className="field-label">Description</label>
          <textarea
            id="cal-event-desc" value={desc} onChange={e => setDesc(e.target.value)}
            placeholder="Optional notes" rows={3} className="input w-full resize-none"
          />
        </div>

        {reconnect && (
          <p data-tone="danger" className="tone-text text-meta">
            Google Calendar needs edit permission. Reconnect it in{' '}
            <Link to="/settings?tab=subscriptions" onClick={onClose} className="font-semibold underline">Settings → Subscriptions</Link>.
          </p>
        )}
      </form>
    </ModalShell>
  )
}
