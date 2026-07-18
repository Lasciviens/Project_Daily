import { useState, useEffect } from 'react'
import { addDays, format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, isToday, isYesterday, isTomorrow, isSameDay, differenceInCalendarDays } from 'date-fns'
import { DayView } from '../components/DayView'
import { DayAgenda } from '../components/DayAgenda'
import { WeekWidget } from '../components/WeekWidget'
import { MonthWidget } from '../components/MonthWidget'
import { TodaySummary } from '../components/TodaySummary'
import { PersonalTabs } from '../../personal/components/PersonalLayout'
import { DateNav } from '../../../shared/components/DateNav'
import { useTasksByMonth } from '../../todo/hooks/useTodos'
import { formatLocalDate } from '../../../shared/utils/dateUtils'

// ─────────────────────────────────────────────────────────────────────────────
//  DailyPage v2 — one compact header row instead of the old three stacked
//  rows (Personal tab bar + 5-tab bar + big date heading):
//    ‹ [date] › · context — [Yesterday|Today|Tomorrow|Week|Month] ——— [Daily|Shop|Recipes]
//  Yesterday/Today/Tomorrow were three near-identical view components — now
//  one DaySection whose tab highlight is DERIVED from the viewed date.
//  Month was removed in v2, then restored as its own tab per request.
// ─────────────────────────────────────────────────────────────────────────────

type Mode = 'day' | 'week' | 'month'

export function DailyPage() {
  const [mode,     setMode]     = useState<Mode>('day')
  const [viewDate, setViewDate] = useState<Date>(new Date())

  function handleDayClick(date: Date) {
    setViewDate(date)
    setMode('day')
  }

  const dayTab: 'yesterday' | 'today' | 'tomorrow' | null =
    mode !== 'day' ? null
      : isYesterday(viewDate) ? 'yesterday'
      : isToday(viewDate)     ? 'today'
      : isTomorrow(viewDate)  ? 'tomorrow'
      : null

  const diff = differenceInCalendarDays(viewDate, new Date())
  const { greeting, timeStr } = useGreeting()

  const context = mode === 'week' ? null
    : isToday(viewDate) ? `${greeting} · ${timeStr}`
    : dayTab === 'yesterday' ? 'Yesterday'
    : dayTab === 'tomorrow'  ? 'Tomorrow'
    : diff > 0 ? `in ${diff} day${diff !== 1 ? 's' : ''}`
    : `${Math.abs(diff)} day${Math.abs(diff) !== 1 ? 's' : ''} ago`

  const tabBtn = (active: boolean) =>
    `px-2.5 min-h-[36px] flex-shrink-0 text-xs font-medium rounded-lg transition-colors duration-150 whitespace-nowrap ${
      active ? 'bg-accent-500 text-white' : 'text-ink-500 hover:text-ink-900 hover:bg-ink-100'
    }`

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-4">
      {/* ── Single compact header row ──
          FIXED-SLOT layout (the standard, not per-case tweaks): the left
          block (date + context) lives in a CONSTANT-width slot with the
          variable text truncating inside it, and the tab cluster is
          right-anchored. Because neither slot's width depends on its text,
          NOTHING can shift when switching Yesterday/Today/Tomorrow — the
          row geometry is fixed by construction. */}
      <div className="flex items-center gap-x-3 gap-y-2 flex-wrap mb-4">
        <div className="flex items-center gap-3 min-w-0 sm:w-[400px] sm:flex-shrink-0">
          <DateNav
            size="md"
            label={format(viewDate, 'EEE, d MMM')}
            labelClassName="text-lg font-bold text-ink-900 min-w-[120px]"
            onPrev={() => { setViewDate(d => addDays(d, -1)); setMode('day') }}
            onNext={() => { setViewDate(d => addDays(d,  1)); setMode('day') }}
            onToday={() => { setViewDate(new Date()); setMode('day') }}
            isToday={mode === 'day' && isToday(viewDate)}
          />
          {context && <span className="text-xs text-accent-600 font-medium hidden sm:inline truncate min-w-0">{context}</span>}
        </div>

        <div className="ml-auto flex items-center gap-3">
          <div className="flex gap-0.5 bg-cream-50 border border-ink-200 p-0.5 rounded-xl overflow-x-auto scrollbar-none">
            <button onClick={() => { setViewDate(addDays(new Date(), -1)); setMode('day') }} className={tabBtn(dayTab === 'yesterday')}>Yesterday</button>
            <button onClick={() => { setViewDate(new Date()); setMode('day') }} className={tabBtn(dayTab === 'today')}>Today</button>
            <button onClick={() => { setViewDate(addDays(new Date(), 1)); setMode('day') }} className={tabBtn(dayTab === 'tomorrow')}>Tomorrow</button>
            <button onClick={() => setMode('week')} className={tabBtn(mode === 'week')}>Week</button>
            <button onClick={() => setMode('month')} className={tabBtn(mode === 'month')}>Month</button>
          </div>
          <PersonalTabs />
        </div>
      </div>

      {mode === 'day' && <DaySection date={viewDate} onDayClick={handleDayClick} />}
      {mode === 'week' && <WeekSection onDayClick={handleDayClick} selectedDate={viewDate} />}
      {mode === 'month' && <MonthSection onDayClick={handleDayClick} selectedDate={viewDate} />}
    </div>
  )
}

function useGreeting() {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])
  const h = now.getHours()
  const greeting = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
  return { greeting, timeStr: format(now, 'HH:mm') }
}

// One unified day view (was three copies: Yesterday/Today/Tomorrow). The
// dashboard strip (TodaySummary) shows for EVERY day — planning tomorrow's
// meals/training/episode from Daily was the whole point of the redesign.
function DaySection({ date, onDayClick }: { date: Date; onDayClick: (d: Date) => void }) {
  return (
    <div className="flex flex-col gap-5">
      {/* COMPACT top row — schedule sits in the MIDDLE column with the day's
          to-do (left) and week (right) filling its flanks: no empty gutters,
          nothing stretched (fixed content-width columns per the standard).
          The releasing-soon banner was removed per request. */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,320px)_minmax(0,540px)_minmax(0,300px)] gap-5 justify-start items-start">
        <DayView date={date} />
        <DayAgenda date={date} />
        <WeekWidget onDayClick={onDayClick} highlightDate={date} />
      </div>

      {/* At a glance — content-width card grid */}
      <TodaySummary date={date} />
    </div>
  )
}

// Month view — two panes: a bigger calendar (left) and, on the right, the
// selected day's schedule IN PLACE (picking a day does NOT navigate away, per
// request — it loads that day's data here). With no day picked, the right pane
// lists upcoming activities; tapping one selects its day. onDayClick is kept
// for the "jump to full Day view" affordance only.
function MonthSection({ onDayClick }: { onDayClick: (d: Date) => void; selectedDate: Date }) {
  const [picked, setPicked] = useState<Date | null>(null)

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,460px)_minmax(0,520px)] gap-6 justify-start">
      <div>
        <MonthWidget big onDayClick={setPicked} highlightDate={picked ?? undefined} />
      </div>
      <div className="min-w-0">
        {picked ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-ink-900">{format(picked, 'EEEE, d MMMM')}</h2>
              <div className="flex items-center gap-1">
                <button onClick={() => onDayClick(picked)}
                  className="text-[11px] text-accent-600 hover:text-accent-700 min-h-[32px] px-2 rounded-lg">Open day →</button>
                <button onClick={() => setPicked(null)}
                  className="text-[11px] text-ink-400 hover:text-ink-700 min-h-[32px] px-2 rounded-lg">✕ Upcoming</button>
              </div>
            </div>
            {/* DayAgenda = the day's editable schedule (add/edit/delete blocks) */}
            <DayAgenda date={picked} />
          </div>
        ) : (
          <UpcomingActivities onPick={setPicked} />
        )}
      </div>
    </div>
  )
}

// Upcoming dated activities (tasks with a due date, today onward) grouped by
// day — the Month tab's default right pane. Tapping a day selects it in the
// calendar (in-place, no navigation).
function UpcomingActivities({ onPick }: { onPick: (d: Date) => void }) {
  const today = new Date()
  const { data: tasks = [] } = useTasksByMonth(startOfMonth(today), endOfMonth(addDays(today, 45)))
  const todayStr = formatLocalDate(today)

  const upcoming = tasks
    .filter(t => t.due_date && t.due_date >= todayStr && t.status !== 'done' && t.status !== 'cancelled')
    .sort((a, b) => (a.due_date! < b.due_date! ? -1 : a.due_date! > b.due_date! ? 1 : (a.due_time ?? '') < (b.due_time ?? '') ? -1 : 1))

  const byDay = new Map<string, typeof upcoming>()
  for (const t of upcoming) {
    const arr = byDay.get(t.due_date!) ?? []
    arr.push(t)
    byDay.set(t.due_date!, arr)
  }

  return (
    <div className="rounded-2xl border border-ink-200 bg-cream-50 p-4 flex flex-col gap-3">
      <p className="text-[11px] font-bold uppercase tracking-wider text-ink-400">📅 Upcoming</p>
      {byDay.size === 0 ? (
        <p className="text-xs text-ink-400 py-2">Nothing scheduled ahead. Tap a day in the calendar to plan it.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {[...byDay.entries()].slice(0, 14).map(([dateStr, items]) => {
            const d = new Date(dateStr + 'T00:00:00')
            return (
              <div key={dateStr}>
                <button onClick={() => onPick(d)}
                  className="text-xs font-semibold text-ink-700 hover:text-accent-600 min-h-[28px] flex items-center gap-2">
                  {format(d, 'EEE, d MMM')}
                  {isSameDay(d, today) && <span className="text-[9px] font-bold text-accent-600 bg-accent-50 rounded-full px-1.5">TODAY</span>}
                </button>
                <ul className="mt-0.5 flex flex-col gap-0.5 pl-1 border-l-2 border-ink-100">
                  {items.map(t => (
                    <li key={t.id} className="pl-2 text-xs text-ink-600 flex items-center gap-1.5">
                      {t.due_time && <span className="text-[10px] text-ink-400 tabular-nums shrink-0">{t.due_time.slice(0, 5)}</span>}
                      <span className="truncate">{t.title}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function WeekSection({ onDayClick, selectedDate }: { onDayClick: (d: Date) => void; selectedDate: Date }) {
  const now   = new Date()
  const start = startOfWeek(now, { weekStartsOn: 1 })
  const end   = endOfWeek(now,   { weekStartsOn: 1 })
  return (
    <div>
      <p className="text-sm text-ink-400 mb-3">{format(start, 'MMM d')} – {format(end, 'MMM d, yyyy')}</p>
      <WeekWidget onDayClick={onDayClick} highlightDate={selectedDate} />
    </div>
  )
}
