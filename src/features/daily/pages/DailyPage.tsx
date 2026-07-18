import { useState, useEffect } from 'react'
import { addDays, format, startOfWeek, endOfWeek, isToday, isYesterday, isTomorrow, differenceInCalendarDays } from 'date-fns'
import { DayView } from '../components/DayView'
import { DayAgenda } from '../components/DayAgenda'
import { WeekWidget } from '../components/WeekWidget'
import { MonthWidget } from '../components/MonthWidget'
import { UpcomingReleasesBanner } from '../components/UpcomingReleasesBanner'
import { TodaySummary } from '../components/TodaySummary'
import { PersonalTabs } from '../../personal/components/PersonalLayout'
import { DateNav } from '../../../shared/components/DateNav'

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
      {/* ── Single compact header row (wraps on narrow screens) ── */}
      <div className="flex items-center gap-x-3 gap-y-2 flex-wrap mb-4">
        <DateNav
          size="md"
          label={format(viewDate, 'EEE, d MMM')}
          labelClassName="text-lg font-bold text-ink-900 min-w-[120px]"
          onPrev={() => { setViewDate(d => addDays(d, -1)); setMode('day') }}
          onNext={() => { setViewDate(d => addDays(d,  1)); setMode('day') }}
          onToday={() => { setViewDate(new Date()); setMode('day') }}
          isToday={mode === 'day' && isToday(viewDate)}
        />
        {context && <span className="text-xs text-accent-600 font-medium hidden sm:inline">{context}</span>}

        <div className="flex gap-0.5 bg-cream-50 border border-ink-200 p-0.5 rounded-xl overflow-x-auto scrollbar-none">
          <button onClick={() => { setViewDate(addDays(new Date(), -1)); setMode('day') }} className={tabBtn(dayTab === 'yesterday')}>Yesterday</button>
          <button onClick={() => { setViewDate(new Date()); setMode('day') }} className={tabBtn(dayTab === 'today')}>Today</button>
          <button onClick={() => { setViewDate(addDays(new Date(), 1)); setMode('day') }} className={tabBtn(dayTab === 'tomorrow')}>Tomorrow</button>
          <button onClick={() => setMode('week')} className={tabBtn(mode === 'week')}>Week</button>
          <button onClick={() => setMode('month')} className={tabBtn(mode === 'month')}>Month</button>
        </div>

        {/* Personal group tabs live in THIS row now (far right) instead of
            their own row above the page — one header row total. */}
        <div className="ml-auto"><PersonalTabs /></div>
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
    <div>
      {isToday(date) && <UpcomingReleasesBanner />}
      <TodaySummary date={date} />
      {/* Content-sized columns, left-aligned (layout rule): the schedule was
          `1fr` and swallowed all leftover width — an agenda list doesn't need
          it. Fixed caps now; spare space stays on the right. */}
      <div className="grid grid-cols-1 lg:grid-cols-[320px_500px_300px] xl:grid-cols-[340px_560px_320px] gap-5 justify-start">
        <div className="lg:pl-1"><DayView date={date} /></div>
        <DayAgenda date={date} />
        <div className="flex flex-col gap-4">
          <WeekWidget onDayClick={onDayClick} highlightDate={date} />
        </div>
      </div>
    </div>
  )
}

// Month view (restored per request — the tab was removed in the v2 redesign,
// now wanted back as its own mode). Clicking a day jumps to its Day view.
function MonthSection({ onDayClick, selectedDate }: { onDayClick: (d: Date) => void; selectedDate: Date }) {
  return (
    <div className="max-w-md">
      <MonthWidget onDayClick={onDayClick} highlightDate={selectedDate} />
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
