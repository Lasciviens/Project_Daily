import { useQueryClient } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import { useCalendarEventsForDay } from '../../calendar/hooks/useCalendar'
import { useCalendarStore, toast } from '../../../app/store'
import type { CalendarEvent } from '../../calendar/types'

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

export function DayCalendarSection({ dateStr }: Props) {
  const token = useCalendarStore(s => s.accessToken)
  const qc    = useQueryClient()
  const { data: events = [], isLoading, isFetching } = useCalendarEventsForDay(dateStr)

  if (!token) return null

  async function handleRefresh() {
    const tid = toast.loading('Refreshing calendar…')
    try {
      await qc.refetchQueries({ queryKey: ['calendar', 'day', dateStr] })
      toast.dismiss(tid); toast.success('Calendar updated ✓')
    } catch (err) {
      toast.dismiss(tid); toast.error((err as Error).message ?? 'Failed to refresh')
    }
  }

  return (
    <div className="card overflow-hidden">
      <div className="h-0.5 bg-blue-400" />
      <div className="p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-500">Google Calendar</h2>
          <button
            onClick={handleRefresh}
            disabled={isFetching}
            title="Refresh calendar"
            className="min-w-[44px] min-h-[44px] flex items-center justify-center text-ink-400 hover:text-accent-600 transition-colors duration-150 disabled:opacity-40 text-lg"
          >
            <span className={isFetching ? 'animate-spin inline-block' : ''}>↻</span>
          </button>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {[1, 2].map(i => <div key={i} className="h-8 bg-cream-200 rounded-lg animate-pulse" />)}
          </div>
        ) : events.length === 0 ? (
          <p className="text-sm text-ink-400 py-2">No events</p>
        ) : (
          <div className="space-y-1.5">
            {events.map(event => (
              <div key={event.id} className="flex items-start gap-2.5 px-3 py-2 rounded-lg bg-cream-50">
                <div className="w-1 h-full min-h-[1.25rem] rounded-full bg-blue-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-ink-800 truncate">{event.summary}</p>
                  {(event.start.dateTime || event.start.date) && (
                    <p className="text-[11px] text-ink-400">
                      {eventTime(event)}{event.end.dateTime ? ` – ${eventEndTime(event)}` : ''}
                      {event.location ? ` · ${event.location}` : ''}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
