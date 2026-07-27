import { useState, useEffect } from 'react'
import { addDays, format, startOfMonth, endOfMonth, isToday, isYesterday, isTomorrow, isSameDay, differenceInCalendarDays } from 'date-fns'
import { DayView } from '../components/DayView'
import { DayAgenda } from '../components/DayAgenda'
import { WeekStrip } from '../components/WeekStrip'
import { DayQuickRail } from '../components/DayQuickRail'
import { WeekWidget } from '../components/WeekWidget'
import { MonthWidget } from '../components/MonthWidget'
import { TodaySummary } from '../components/TodaySummary'
import { TasksPanel } from '../components/TasksPanel'
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

type Mode = 'day' | 'week' | 'month' | 'tasks'

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
    `px-2.5 min-h-[44px] flex-shrink-0 text-xs font-medium rounded-lg transition-colors duration-150 whitespace-nowrap ${
      active ? 'bg-accent-500 text-white' : 'text-ink-500 hover:text-ink-900 hover:bg-ink-100'
    }`

  // Full-width segmented-control cell for the mobile period selector.
  const segBtn = (active: boolean) =>
    `min-h-[44px] flex items-center justify-center text-xs font-semibold rounded-lg transition-colors duration-150 ${
      active ? 'bg-accent-500 text-white' : 'text-ink-600 hover:bg-ink-100'
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
      {/* ── Mobile header: two tight rows (date + group tabs, then a full-width
          Today/Week/Month segmented control). Yesterday/Tomorrow are reachable
          via the ‹ › DateNav, so the phone drops those two redundant tabs that
          used to crush the selector off-screen. ── */}
      <div className="sm:hidden mb-3 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <DateNav
              size="md"
              label={format(viewDate, 'EEE, d MMM')}
              labelClassName="text-base font-bold text-ink-900 truncate"
              onPrev={() => { setViewDate(d => addDays(d, -1)); setMode('day') }}
              onNext={() => { setViewDate(d => addDays(d,  1)); setMode('day') }}
              onToday={() => { setViewDate(new Date()); setMode('day') }}
              isToday={mode === 'day' && isToday(viewDate)}
            />
          </div>
        </div>
        <div className="grid grid-cols-4 gap-0.5 bg-cream-50 border border-ink-200 p-0.5 rounded-xl">
          <button onClick={() => { setViewDate(new Date()); setMode('day') }} className={segBtn(mode === 'day' && isToday(viewDate))}>Today</button>
          <button onClick={() => setMode('week')} className={segBtn(mode === 'week')}>Week</button>
          <button onClick={() => setMode('month')} className={segBtn(mode === 'month')}>Month</button>
          <button onClick={() => setMode('tasks')} className={segBtn(mode === 'tasks')}>Tasks</button>
        </div>
      </div>

      {/* ── Desktop header: the original single compact row ── */}
      <div className="hidden sm:flex items-center gap-x-3 gap-y-2 flex-wrap mb-4">
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

        {/* Period tabs scroll internally if they don't fit (min-w-0 + overflow).
            Daily is standalone now — the Food/Shop group tabs moved to the Food
            nav entry, so no in-header group tabs remain here. */}
        <div className="ml-auto flex items-center gap-2 min-w-0 max-w-full">
          <div className="flex gap-0.5 bg-cream-50 border border-ink-200 p-0.5 rounded-xl overflow-x-auto scrollbar-none min-w-0">
            <button onClick={() => { setViewDate(addDays(new Date(), -1)); setMode('day') }} className={tabBtn(dayTab === 'yesterday')}>Yesterday</button>
            <button onClick={() => { setViewDate(new Date()); setMode('day') }} className={tabBtn(dayTab === 'today')}>Today</button>
            <button onClick={() => { setViewDate(addDays(new Date(), 1)); setMode('day') }} className={tabBtn(dayTab === 'tomorrow')}>Tomorrow</button>
            <button onClick={() => setMode('week')} className={tabBtn(mode === 'week')}>Week</button>
            <button onClick={() => setMode('month')} className={tabBtn(mode === 'month')}>Month</button>
            <button onClick={() => setMode('tasks')} className={tabBtn(mode === 'tasks')}>Tasks</button>
          </div>
        </div>
      </div>

      {mode === 'day' && <DaySection date={viewDate} onDayClick={handleDayClick} onOpenTasks={() => setMode('tasks')} />}
      {mode === 'week' && <WeekSection onDayClick={handleDayClick} selectedDate={viewDate} />}
      {mode === 'month' && <MonthSection onDayClick={handleDayClick} selectedDate={viewDate} />}
      {mode === 'tasks' && <TasksPanel />}
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
// dashboard board (TodaySummary) shows for EVERY day — planning tomorrow's
// meals/training/episode from Daily was the whole point of the redesign.
//
// TWO stacked bands ("Day Schedule on its own row, the summary cells below" —
// explicit request). Boxes still never change position (no auto-fill anywhere):
//   ROW 1 — the SCHEDULE HERO (week strip + Schedule + Tasks in one card, the
//     page's single accent bar). On wide viewports (xl+, covers laptop 1469 and
//     monitor 2450) a companion rail fills the freed horizontal band beside it
//     (quick actions / next-up / jump-to) instead of stretching the timeline;
//     below xl the hero is full width and the rail is hidden (no gap to fill).
//   ROW 2 — the GLANCE BOARD: the life modules as fixed cells of one panel,
//     full width now (up to 4 cols on 2xl), Nutrition given a double slot.
function DaySection({ date, onDayClick, onOpenTasks }: { date: Date; onDayClick: (d: Date) => void; onOpenTasks?: () => void }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="xl:grid xl:grid-cols-[minmax(0,60rem)_minmax(0,1fr)] xl:gap-6 xl:items-stretch">
        <section className="w-full bg-cream-50 border border-ink-200 rounded-2xl shadow-card overflow-hidden">
          <div className="h-0.5 bg-accent-500" />
          <WeekStrip viewDate={date} onDayClick={onDayClick} />
          <div className="lg:grid lg:grid-cols-[minmax(0,34rem)_minmax(0,1fr)] lg:divide-x lg:divide-ink-100 divide-y divide-ink-100 lg:divide-y-0">
            <DayAgenda date={date} bare />
            <DayView date={date} />
          </div>
        </section>

        <DayQuickRail date={date} onOpenTasks={onOpenTasks} />
      </div>

      <TodaySummary date={date} />
    </div>
  )
}

// Month view — two panes: a bigger calendar (left) and, on the right, the
// selected day's schedule IN PLACE (picking a day does NOT navigate away, per
// request — it loads that day's data here). With no day picked, the right pane
// lists upcoming activities; tapping one selects its day. onDayClick is kept
// for the "jump to full Day view" affordance only.
function MonthSection({ onDayClick, selectedDate }: { onDayClick: (d: Date) => void; selectedDate: Date }) {
  // Preselect the day the user was viewing (the prop was passed but dropped
  // during a refactor — switching to Month lost the context entirely).
  const [picked, setPicked] = useState<Date | null>(isToday(selectedDate) ? null : selectedDate)

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
                  className="text-[11px] text-accent-600 hover:text-accent-700 min-h-[44px] px-2 rounded-lg">Open day →</button>
                <button onClick={() => setPicked(null)}
                  className="text-[11px] text-ink-500 hover:text-ink-700 min-h-[44px] px-2 rounded-lg">✕ Upcoming</button>
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
                  className="text-xs font-semibold text-ink-700 hover:text-accent-600 min-h-[44px] flex items-center gap-2">
                  {format(d, 'EEE, d MMM')}
                  {isSameDay(d, today) && <span className="text-[9px] font-bold text-accent-600 bg-accent-50 rounded-full px-1.5">TODAY</span>}
                </button>
                <ul className="mt-0.5 flex flex-col gap-1.5 pl-1 border-l-2 border-ink-100">
                  {items.map(t => (
                    <li key={t.id} className="pl-2 py-0.5 text-xs text-ink-600 flex items-center gap-1.5">
                      {/* The time column is ALWAYS reserved (empty when a task
                          has no time) — rendering it conditionally gave the
                          list two different left edges and read as broken
                          indentation. */}
                      <span className="w-10 shrink-0 text-[10px] text-ink-500 tabular-nums">{t.due_time?.slice(0, 5) ?? ''}</span>
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
  // No range label here: WeekWidget prints its own, driven by ITS weekOffset.
  // The copy that used to sit above it was computed from new Date(), so paging
  // the widget back left the outer label showing the current week — two ranges
  // on screen, one of them lying.
  return <WeekWidget onDayClick={onDayClick} highlightDate={selectedDate} />
}
