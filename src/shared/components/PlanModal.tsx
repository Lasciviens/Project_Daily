import { useState } from 'react'
import { Dialog, DialogPanel, DialogBackdrop } from '@headlessui/react'
import { format, addDays, parseISO, getISOWeek } from 'date-fns'
import { toast, useCalendarStore } from '../../app/store'
import { useCreateTimeBlock } from '../../features/daily/hooks/useSchedule'
import { useCreateTask } from '../../features/todo/hooks/useTodos'
import { createCalendarEvent } from '../../features/calendar/api/calendarApi'
import type { TimeBlockCategory } from '../../features/daily/types'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PlanModalProps {
  open: boolean
  onClose: () => void
  defaultTitle?:    string
  defaultDate?:     string       // yyyy-MM-dd, defaults to today
  defaultCategory?: TimeBlockCategory
  defaultStartTime?: string      // HH:MM
  defaultDuration?: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DURATIONS = [30, 60, 90, 120, 180]

function todayStr(): string {
  return format(new Date(), 'yyyy-MM-dd')
}

function tomorrowStr(): string {
  return format(addDays(new Date(), 1), 'yyyy-MM-dd')
}

function displayDate(iso: string): string {
  try {
    const d = parseISO(iso)
    return `${format(d, 'dd.MM.yyyy EEE')} · W${getISOWeek(d)}`
  } catch {
    return iso
  }
}

const CATEGORY_LABELS: Record<TimeBlockCategory, string> = {
  daily:    'Daily',
  training: 'Training',
  media:    'Media',
  games:    'Games',
  work:     'Work',
  projects: 'Projects',
  other:    'Other',
}

const LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone

const RECURRENCE_OPTIONS = [
  { value: 'none',     label: 'No repeat'     },
  { value: 'daily',    label: 'Every day'     },
  { value: 'weekly',   label: 'Every week'    },
  { value: 'weekdays', label: 'Weekdays only' },
]

// ─── PlanModal ────────────────────────────────────────────────────────────────

export function PlanModal({
  open,
  onClose,
  defaultTitle = '',
  defaultDate,
  defaultCategory = 'other',
  defaultStartTime = '09:00',
  defaultDuration = 60,
}: PlanModalProps) {
  const today = todayStr()
  const [title,      setTitle]      = useState(defaultTitle)
  const [date,       setDate]       = useState(defaultDate ?? today)
  const [startTime,  setStartTime]  = useState(defaultStartTime)
  const [duration,   setDuration]   = useState(defaultDuration)
  const [customMin,  setCustomMin]  = useState('')
  const [category,   setCategory]   = useState<TimeBlockCategory>(defaultCategory)
  const [recurrence, setRecurrence] = useState('none')
  const [addTodo,    setAddTodo]    = useState(false)
  const [addGcal,    setAddGcal]    = useState(false)
  const [saving,     setSaving]     = useState(false)

  const calToken     = useCalendarStore(s => s.accessToken)
  const createBlock  = useCreateTimeBlock()
  const createTask   = useCreateTask()

  function stepDate(dir: 1 | -1) {
    try {
      setDate(format(addDays(parseISO(date), dir), 'yyyy-MM-dd'))
    } catch { /* invalid date */ }
  }

  function stepTime(dir: 1 | -1) {
    const [hh, mm] = startTime.split(':').map(Number)
    let newH = hh + dir
    if (newH < 0) newH = 23
    if (newH > 23) newH = 0
    setStartTime(`${String(newH).padStart(2, '0')}:${String(mm).padStart(2, '0')}`)
  }

  async function handleSave() {
    if (!title.trim()) { toast.error('Title is required'); return }
    setSaving(true)
    const tid = toast.loading('Planning…')

    try {
      const effectiveDuration = customMin !== '' ? Number(customMin) || 60 : duration

      await createBlock.mutateAsync({
        date,
        title: title.trim(),
        start_time:       startTime,
        duration_minutes: effectiveDuration,
        category,
      })

      if (addTodo) {
        await createTask.mutateAsync({
          title:   title.trim(),
          section: 'today',
          domain:  category === 'work' ? 'work' : 'personal',
        })
      }

      if (addGcal && calToken) {
        try {
          const startISO = new Date(`${date}T${startTime}:00`).toISOString()
          const endISO   = new Date(new Date(`${date}T${startTime}:00`).getTime() + effectiveDuration * 60_000).toISOString()
          await createCalendarEvent(calToken, 'primary', {
            summary: title.trim(),
            start:   { dateTime: startISO, timeZone: LOCAL_TZ },
            end:     { dateTime: endISO,   timeZone: LOCAL_TZ },
          })
        } catch {
          toast.error('Added locally, Google Calendar sync failed')
        }
      }

      toast.dismiss(tid)
      toast.success('Planned ✓')
      onClose()
    } catch (err) {
      toast.dismiss(tid)
      toast.error((err as Error).message ?? 'Failed to plan')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} className="relative z-[60]">
      <DialogBackdrop
        transition
        className="fixed inset-0 bg-ink-900/30 transition duration-200 data-[closed]:opacity-0"
      />
      <div className="fixed inset-0 flex items-end sm:items-center justify-center p-0 sm:p-4">
        <DialogPanel
          transition
          className="w-full rounded-t-2xl sm:rounded-2xl sm:max-w-md max-h-[90vh] overflow-y-auto bg-white border border-ink-200 transition duration-200 data-[closed]:opacity-0 data-[closed]:translate-y-4 sm:data-[closed]:translate-y-0 sm:data-[closed]:scale-95"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-ink-100 sticky top-0 bg-white z-10">
            <h2 className="text-base font-bold text-ink-900">Plan</h2>
            <button
              type="button"
              onClick={onClose}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center text-ink-400 hover:text-ink-700 text-xl"
            >
              ×
            </button>
          </div>

          <div className="px-5 py-4 flex flex-col gap-4">
            {/* Title */}
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-ink-400 mb-1.5 block">
                Title <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="What are you planning?"
                className="w-full min-h-[44px] bg-cream-50 border border-ink-200 rounded-xl px-4 text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-accent-400"
              />
            </div>

            {/* Date */}
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-ink-400 mb-1.5 block">Date</label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => stepDate(-1)}
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center border border-ink-200 rounded-xl text-ink-600 hover:bg-cream-50 transition-colors"
                >
                  ←
                </button>
                <div className="flex-1 text-center">
                  <input
                    type="date"
                    value={date}
                    onChange={e => setDate(e.target.value)}
                    className="sr-only"
                    id="plan-date-input"
                  />
                  <label
                    htmlFor="plan-date-input"
                    className="block min-h-[44px] bg-cream-50 border border-ink-200 rounded-xl px-3 text-sm text-ink-900 font-medium cursor-pointer flex items-center justify-center"
                  >
                    {displayDate(date)}
                  </label>
                </div>
                <button
                  type="button"
                  onClick={() => stepDate(1)}
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center border border-ink-200 rounded-xl text-ink-600 hover:bg-cream-50 transition-colors"
                >
                  →
                </button>
              </div>
              <div className="flex gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => setDate(today)}
                  className={`flex-1 min-h-[36px] text-xs font-medium rounded-lg border transition-colors ${
                    date === today
                      ? 'bg-accent-500 text-white border-accent-500'
                      : 'border-ink-200 text-ink-600 hover:bg-cream-50'
                  }`}
                >
                  Today
                </button>
                <button
                  type="button"
                  onClick={() => setDate(tomorrowStr())}
                  className={`flex-1 min-h-[36px] text-xs font-medium rounded-lg border transition-colors ${
                    date === tomorrowStr()
                      ? 'bg-accent-500 text-white border-accent-500'
                      : 'border-ink-200 text-ink-600 hover:bg-cream-50'
                  }`}
                >
                  Tomorrow
                </button>
              </div>
            </div>

            {/* Time */}
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-ink-400 mb-1.5 block">Start time (24h)</label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => stepTime(-1)}
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center border border-ink-200 rounded-xl text-ink-600 hover:bg-cream-50 transition-colors text-lg"
                >
                  ↓
                </button>
                <input
                  type="time"
                  value={startTime}
                  onChange={e => setStartTime(e.target.value)}
                  className="flex-1 min-h-[44px] bg-cream-50 border border-ink-200 rounded-xl px-4 text-sm text-ink-900 focus:outline-none focus:ring-2 focus:ring-accent-400 text-center"
                />
                <button
                  type="button"
                  onClick={() => stepTime(1)}
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center border border-ink-200 rounded-xl text-ink-600 hover:bg-cream-50 transition-colors text-lg"
                >
                  ↑
                </button>
              </div>
            </div>

            {/* Duration */}
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-ink-400 mb-1.5 block">Duration</label>
              <div className="flex flex-wrap gap-2">
                {DURATIONS.map(d => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => { setDuration(d); setCustomMin('') }}
                    className={`min-h-[36px] px-3 text-xs font-medium rounded-lg border transition-colors ${
                      duration === d && customMin === ''
                        ? 'bg-accent-500 text-white border-accent-500'
                        : 'border-ink-200 text-ink-600 hover:bg-cream-50'
                    }`}
                  >
                    {d < 60 ? `${d}m` : d % 60 === 0 ? `${d / 60}h` : `${Math.floor(d / 60)}h${d % 60}m`}
                  </button>
                ))}
                <input
                  type="number"
                  min="1"
                  value={customMin}
                  onChange={e => setCustomMin(e.target.value)}
                  placeholder="Custom"
                  className="min-h-[36px] w-20 bg-cream-50 border border-ink-200 rounded-lg px-2 text-xs text-ink-900 focus:outline-none focus:ring-1 focus:ring-accent-400"
                />
              </div>
            </div>

            {/* Category */}
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-ink-400 mb-1.5 block">Category</label>
              <select
                value={category}
                onChange={e => setCategory(e.target.value as TimeBlockCategory)}
                className="w-full min-h-[44px] bg-cream-50 border border-ink-200 rounded-xl px-4 text-sm text-ink-900 focus:outline-none focus:ring-2 focus:ring-accent-400"
              >
                {(Object.entries(CATEGORY_LABELS) as [TimeBlockCategory, string][]).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>

            {/* Recurrence */}
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-ink-400 mb-1.5 block">Repeat</label>
              <div className="flex flex-wrap gap-2">
                {RECURRENCE_OPTIONS.map(o => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => setRecurrence(o.value)}
                    className={`min-h-[36px] px-3 text-xs font-medium rounded-lg border transition-colors ${
                      recurrence === o.value
                        ? 'bg-ink-900 text-white border-ink-900'
                        : 'border-ink-200 text-ink-600 hover:bg-cream-50'
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Checkboxes */}
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-3 min-h-[44px] cursor-pointer">
                <input
                  type="checkbox"
                  checked={addTodo}
                  onChange={e => setAddTodo(e.target.checked)}
                  className="w-4 h-4 accent-accent-500 rounded"
                />
                <span className="text-sm text-ink-700">Add to To-Do</span>
              </label>
              {calToken && (
                <label className="flex items-center gap-3 min-h-[44px] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={addGcal}
                    onChange={e => setAddGcal(e.target.checked)}
                    className="w-4 h-4 accent-accent-500 rounded"
                  />
                  <span className="text-sm text-ink-700">Add to Google Calendar</span>
                </label>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="px-5 py-4 border-t border-ink-100 flex gap-3 sticky bottom-0 bg-white">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 min-h-[44px] border border-ink-200 text-ink-700 rounded-xl text-sm font-medium hover:bg-cream-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !title.trim()}
              className="flex-1 min-h-[44px] bg-accent-500 text-white rounded-xl text-sm font-semibold hover:bg-accent-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? 'Planning…' : 'Plan it'}
            </button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  )
}
