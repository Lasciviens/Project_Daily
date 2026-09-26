import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ModalShell, useEntityModal } from '../../../shared/modals'
import { Button } from '../../../shared/ui'
import { useUpdateCalendarEvent, useDeleteCalendarEvent } from '../hooks/useCalendar'
import type { CalendarEvent } from '../types'

// User's local IANA timezone — the fallback when the event carries none.
const LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone

function toLocalDatetimeInput(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

interface Props {
  event:   CalendarEvent
  onClose: () => void
}

/** Edit or delete one Google Calendar event. The hooks toast the result. */
export function EditCalendarEventModal({ event, onClose }: Props) {
  const modal = useEntityModal()
  const [title,   setTitle]   = useState(event.summary ?? '')
  const [desc,    setDesc]    = useState(event.description ?? '')
  const [startDT, setStartDT] = useState(event.start.dateTime ? toLocalDatetimeInput(event.start.dateTime) : '')
  const [endDT,   setEndDT]   = useState(event.end.dateTime ? toLocalDatetimeInput(event.end.dateTime) : '')

  const update = useUpdateCalendarEvent()
  const remove = useDeleteCalendarEvent()

  const isPending  = update.isPending || remove.isPending
  const calendarId = event.calendarId ?? 'primary'

  // The hook already toasts the message; a missing write scope additionally
  // needs a way out, so it gets an inline pointer to Connections.
  const error = ((update.error || remove.error) as Error | null)?.message ?? ''
  const needsReconnect = /403|insufficientPermissions|forbidden/i.test(error)

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    const patch: Record<string, unknown> = { summary: title.trim() }
    if (desc !== (event.description ?? '')) patch.description = desc
    if (startDT) patch.start = { dateTime: new Date(startDT).toISOString(), timeZone: event.start.timeZone ?? LOCAL_TZ }
    if (endDT)   patch.end   = { dateTime: new Date(endDT).toISOString(),   timeZone: event.end.timeZone ?? LOCAL_TZ }
    try {
      await update.mutateAsync({ calendarId, eventId: event.id, patch })
      onClose()
    } catch { /* toasted by the hook */ }
  }

  async function handleDelete() {
    const ok = await modal.confirm({ title: 'Delete this event?', message: 'It is removed from Google Calendar.', confirmLabel: 'Delete', destructive: true })
    if (!ok) return
    try {
      await remove.mutateAsync({ calendarId, eventId: event.id })
      onClose()
    } catch { /* toasted by the hook */ }
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
            <Button variant="primary" type="submit" form="edit-calendar-event" loading={update.isPending} disabled={isPending || !title.trim()}>
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
            id="cal-event-title"
            autoFocus
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Event title"
            className="input w-full"
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="cal-event-start" className="field-label">Start</label>
            <input id="cal-event-start" type="datetime-local" value={startDT} onChange={e => setStartDT(e.target.value)} className="input w-full" />
          </div>
          <div>
            <label htmlFor="cal-event-end" className="field-label">End</label>
            <input id="cal-event-end" type="datetime-local" value={endDT} onChange={e => setEndDT(e.target.value)} className="input w-full" />
          </div>
        </div>

        <div>
          <label htmlFor="cal-event-desc" className="field-label">Description</label>
          <textarea
            id="cal-event-desc"
            value={desc}
            onChange={e => setDesc(e.target.value)}
            placeholder="Optional notes"
            rows={3}
            className="input w-full resize-none"
          />
        </div>

        {needsReconnect && (
          <p data-tone="danger" className="tone-text text-meta">
            Google Calendar needs edit permission. Reconnect it in{' '}
            <Link to="/developer?tab=connections" onClick={onClose} className="font-semibold underline">Connections</Link>.
          </p>
        )}
      </form>
    </ModalShell>
  )
}
