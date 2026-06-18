import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { useCalendarEventsForDay } from '../hooks/useCalendar'
import { useCalendarStore } from '../../../app/store'
import { EditCalendarEventModal } from './EditCalendarEventModal'
import type { CalendarEvent } from '../types'

function eventTime(event: CalendarEvent): string {
  if (event.start.date && !event.start.dateTime) return 'All day'
  if (!event.start.dateTime) return ''
  return format(parseISO(event.start.dateTime), 'HH:mm')
}

function eventEndTime(event: CalendarEvent): string {
  if (!event.end.dateTime) return ''
  return format(parseISO(event.end.dateTime), 'HH:mm')
}

interface Props { dateStr: string }

export function CalendarEventsCard({ dateStr }: Props) {
  const { accessToken, expiresAt } = useCalendarStore()
  const isValid = !!accessToken && (!expiresAt || Date.now() < expiresAt - 60_000)
  const { data: events = [], isLoading } = useCalendarEventsForDay(dateStr)

  const [editing,   setEditing]   = useState<CalendarEvent | null>(null)
  const [creating,  setCreating]  = useState(false)

  if (!isValid) return null

  return (
    <>
      <div className="card p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-500">Calendar</h2>
          <div className="flex items-center gap-2">
            {!isLoading && events.length > 0 && (
              <span className="text-xs text-ink-400">{events.length} event{events.length !== 1 ? 's' : ''}</span>
            )}
            <button
              onClick={() => setCreating(true)}
              className="w-6 h-6 flex items-center justify-center rounded-full bg-accent-100 hover:bg-accent-200 text-accent-600 text-sm font-bold transition-colors duration-150"
              title="New event"
            >+</button>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {[1, 2].map(i => <div key={i} className="h-8 bg-cream-200 rounded-lg animate-pulse" />)}
          </div>
        ) : events.length === 0 ? (
          <p className="text-sm text-ink-400 italic">No events scheduled.</p>
        ) : (
          <div className="space-y-1">
            {events.map(event => (
              <button
                key={event.id}
                onClick={() => setEditing(event)}
                className="w-full flex items-start gap-2.5 px-3 py-2 min-h-[44px] rounded-lg hover:bg-cream-100 transition-colors duration-150 group text-left"
              >
                <div className="w-1 self-stretch rounded-full bg-accent-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-ink-800 truncate">{event.summary}</p>
                  <p className="text-[11px] text-ink-400">
                    {eventTime(event)}{event.end.dateTime ? ` – ${eventEndTime(event)}` : ''}
                    {event.location ? ` · ${event.location}` : ''}
                  </p>
                </div>
                <span className="text-[10px] text-ink-300 group-hover:text-ink-500 transition-colors duration-150 flex-shrink-0">✏️</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {editing && (
        <EditCalendarEventModal
          mode="edit"
          event={editing}
          onClose={() => setEditing(null)}
        />
      )}

      {creating && (
        <EditCalendarEventModal
          mode="create"
          initialDate={dateStr}
          onClose={() => setCreating(false)}
        />
      )}
    </>
  )
}
