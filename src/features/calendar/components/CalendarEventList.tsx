import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { useCalendarEventsForDay } from '../hooks/useCalendar'
import { useCalendarStore } from '../../../app/store'
import { EditCalendarEventModal } from './EditCalendarEventModal'
import type { CalendarEvent } from '../types'

function eventTime(event: CalendarEvent): string {
  const start = event.start.dateTime ?? event.start.date
  if (!start) return ''
  if (event.start.date && !event.start.dateTime) return 'All day'
  return format(parseISO(start), 'HH:mm')
}

function eventEndTime(event: CalendarEvent): string {
  const end = event.end.dateTime
  if (!end) return ''
  return format(parseISO(end), 'HH:mm')
}

interface Props { dateStr: string }

export function CalendarEventList({ dateStr }: Props) {
  const token = useCalendarStore(s => s.accessToken)
  const { data: events = [], isLoading } = useCalendarEventsForDay(dateStr)

  const [editing,  setEditing]  = useState<CalendarEvent | null>(null)
  const [creating, setCreating] = useState(false)

  if (!token) return null
  if (isLoading) return (
    <div className="space-y-1.5 mt-3">
      {[1, 2].map(i => (
        <div key={i} className="h-8 rounded-lg bg-cream-200 animate-pulse" />
      ))}
    </div>
  )
  if (events.length === 0 && !token) return null

  return (
    <>
      <div className="mt-3 space-y-1.5">
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-400">Calendar</p>
          <button
            onClick={() => setCreating(true)}
            className="w-5 h-5 flex items-center justify-center rounded-full bg-accent-100 hover:bg-accent-200 text-accent-600 text-xs font-bold transition-colors duration-150"
            title="New event"
          >+</button>
        </div>

        {events.length === 0 ? (
          <p className="text-xs text-ink-400 italic px-1">No events</p>
        ) : events.map(event => (
          <button
            key={event.id}
            onClick={() => setEditing(event)}
            className="w-full flex items-start gap-2.5 px-3 py-2 min-h-[44px] rounded-lg hover:bg-cream-100 transition-colors duration-150 group text-left"
          >
            <div className="w-1 h-full min-h-[1.5rem] rounded-full bg-accent-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-ink-800 truncate">{event.summary}</p>
              {(event.start.dateTime || event.start.date) && (
                <p className="text-[11px] text-ink-400">
                  {eventTime(event)}{event.end.dateTime ? ` – ${eventEndTime(event)}` : ''}
                  {event.location ? ` · ${event.location}` : ''}
                </p>
              )}
            </div>
            <span className="text-[10px] text-ink-300 group-hover:text-ink-500 transition-colors duration-150 flex-shrink-0">✏️</span>
          </button>
        ))}
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
