import { useState, useEffect } from 'react'
import { useUpdateCalendarEvent, useDeleteCalendarEvent, useCreateCalendarEvent } from '../hooks/useCalendar'
import { toast } from '../../../app/store'
import type { CalendarEvent } from '../types'

// User's local IANA timezone — used for all new/edited events
const LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone

function toLocalDatetimeInput(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// Default start/end for a new event: next whole hour + 1h duration
function defaultTimes(date: string): { start: string; end: string } {
  const now      = new Date()
  const nextHour = Math.min(now.getHours() + 1, 23)  // clamp: hour 24 is invalid
  const base     = new Date(`${date}T${String(nextHour).padStart(2, '0')}:00`)
  const end      = new Date(base.getTime() + 60 * 60_000)
  return { start: toLocalDatetimeInput(base.toISOString()), end: toLocalDatetimeInput(end.toISOString()) }
}

interface EditProps {
  mode:    'edit'
  event:   CalendarEvent
  onClose: () => void
}

interface CreateProps {
  mode:        'create'
  initialDate: string   // 'yyyy-MM-dd'
  onClose:     () => void
}

type Props = EditProps | CreateProps

export function EditCalendarEventModal(props: Props) {
  const isCreate = props.mode === 'create'

  const defaults = isCreate
    ? defaultTimes((props as CreateProps).initialDate)
    : null

  const event = isCreate ? null : (props as EditProps).event

  const [title,         setTitle]         = useState(event?.summary ?? '')
  const [desc,          setDesc]          = useState(event?.description ?? '')
  const [startDT,       setStartDT]       = useState(
    event?.start.dateTime ? toLocalDatetimeInput(event.start.dateTime) : (defaults?.start ?? '')
  )
  const [endDT,         setEndDT]         = useState(
    event?.end.dateTime   ? toLocalDatetimeInput(event.end.dateTime)   : (defaults?.end   ?? '')
  )
  const [confirmDelete, setConfirmDelete] = useState(false)

  const update  = useUpdateCalendarEvent()
  const remove  = useDeleteCalendarEvent()
  const create  = useCreateCalendarEvent()

  const isPending  = update.isPending || remove.isPending || create.isPending
  const calendarId = event?.calendarId ?? 'primary'

  const anyError     = (update.error || remove.error || create.error) as Error | null
  const error        = anyError?.message ?? null
  const needsReconnect = error?.includes('403') || error?.includes('insufficientPermissions') || error?.includes('forbidden')

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') props.onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [props.onClose])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    const tid = toast.loading(isCreate ? 'Creating event…' : 'Saving changes…')
    try {
      if (isCreate) {
        await create.mutateAsync({
          calendarId,
          event: {
            summary:     title.trim(),
            description: desc || undefined,
            start:       { dateTime: new Date(startDT).toISOString(), timeZone: LOCAL_TZ },
            end:         { dateTime: new Date(endDT).toISOString(),   timeZone: LOCAL_TZ },
          },
        })
        toast.dismiss(tid); toast.success('Event created ✓')
      } else {
        const patch: Record<string, unknown> = { summary: title.trim() }
        if (desc !== (event!.description ?? '')) patch.description = desc
        if (startDT) patch.start = { dateTime: new Date(startDT).toISOString(), timeZone: event!.start.timeZone ?? LOCAL_TZ }
        if (endDT)   patch.end   = { dateTime: new Date(endDT).toISOString(),   timeZone: event!.end.timeZone   ?? LOCAL_TZ }
        await update.mutateAsync({ calendarId, eventId: event!.id, patch })
        toast.dismiss(tid); toast.success('Event updated ✓')
      }
      props.onClose()
    } catch (err) {
      toast.dismiss(tid)
      toast.error((err as Error).message ?? 'Failed to save event')
    }
  }

  async function handleDelete() {
    const tid = toast.loading('Deleting event…')
    try {
      await remove.mutateAsync({ calendarId, eventId: event!.id })
      toast.dismiss(tid); toast.success('Event deleted')
      props.onClose()
    } catch (err) {
      toast.dismiss(tid)
      toast.error((err as Error).message ?? 'Failed to delete event')
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center px-4 sm:px-4">
      <div className="absolute inset-0 bg-ink-900/30" onClick={props.onClose} />

      <div className="relative w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-card-hover border border-ink-200 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h2 className="text-sm font-semibold text-ink-800">
            {isCreate ? 'New Event' : 'Edit Event'}
          </h2>
          <button
            onClick={props.onClose}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center text-ink-400 hover:text-ink-700 transition-colors duration-150 text-xl leading-none"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSave} className="px-5 pb-5 flex flex-col gap-4">
          <input
            autoFocus
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Event title"
            className="w-full bg-cream-50 border border-ink-200 rounded-xl px-4 py-3 text-sm text-ink-900
                       placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-accent-400
                       focus:border-accent-400 transition-colors duration-150"
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-ink-400 mb-1.5 block">Start</label>
              <input
                type="datetime-local"
                value={startDT}
                onChange={e => setStartDT(e.target.value)}
                className="w-full bg-ink-100 border-none rounded-lg px-3 py-2 text-sm text-ink-700 min-h-[44px]
                           focus:outline-none focus:ring-2 focus:ring-accent-400 transition-colors duration-150"
              />
            </div>
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-ink-400 mb-1.5 block">End</label>
              <input
                type="datetime-local"
                value={endDT}
                onChange={e => setEndDT(e.target.value)}
                className="w-full bg-ink-100 border-none rounded-lg px-3 py-2 text-sm text-ink-700 min-h-[44px]
                           focus:outline-none focus:ring-2 focus:ring-accent-400 transition-colors duration-150"
              />
            </div>
          </div>

          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wider text-ink-400 mb-1.5 block">Description</label>
            <textarea
              value={desc}
              onChange={e => setDesc(e.target.value)}
              placeholder="Optional notes…"
              rows={2}
              className="w-full bg-cream-50 border border-ink-200 rounded-xl px-4 py-2.5 text-sm text-ink-900
                         placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-accent-400
                         focus:border-accent-400 transition-colors duration-150 resize-none"
            />
          </div>

          {error && (
            <p className="text-xs text-red-500">
              {needsReconnect
                ? 'Your Google Calendar needs to be reconnected with edit permissions. Disconnect and reconnect Calendar from the header.'
                : error}
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={isPending || !title.trim()}
              className="btn-primary flex-1 min-h-[44px] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isPending && isCreate  ? 'Creating…'  :
               isPending && !isCreate ? 'Saving…'    :
               isCreate               ? 'Create event' : 'Save changes'}
            </button>

            {!isCreate && (
              !confirmDelete ? (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  disabled={isPending}
                  className="px-3 rounded-lg text-sm text-red-500 hover:bg-red-50 transition-colors duration-150 disabled:opacity-40 min-h-[44px]"
                >
                  Delete
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={isPending}
                  className="px-3 rounded-lg text-sm bg-red-500 text-white hover:bg-red-600 transition-colors duration-150 disabled:opacity-40 min-h-[44px]"
                >
                  {remove.isPending ? 'Deleting…' : 'Confirm delete'}
                </button>
              )
            )}
          </div>
        </form>
      </div>
    </div>
  )
}
