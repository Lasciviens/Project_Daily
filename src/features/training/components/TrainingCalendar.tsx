import { useCallback, useState, useMemo } from 'react'
import { useHevyWorkouts } from '../hooks/useHevyWorkouts'
import { useStravaActivities } from '../hooks/useStravaActivities'
import { useTrainingBlocks, useScheduleBlocks } from '../../daily/hooks/useSchedule'
import { projectRecurringBlocksForDay } from '../../daily/components/dayAgendaProjection'
import { useEntityModal } from '../../../shared/modals'
import { DateNav } from '../../../shared/components/DateNav'
import { Card, SegmentedControl, ToneDot, type Tone } from '../../../shared/ui'
import { STRAVA_ORANGE } from '../stravaMeta'
import { StravaTypeIcon } from './StravaIcons'
import { formatLocalDate } from '../../../shared/utils/dateUtils'
import type { HevyWorkout, StravaActivity } from '../types.hevy'
import type { TimeBlock, ScheduleBlock } from '../../daily/types'

// A calendar "plan" entry is either a real one-off time_blocks row, or a
// PROJECTED occurrence of a recurring schedule_blocks template (e.g. "every
// Mon/Wed/Fri 16:30") — the calendar used to only ever fetch one-off training
// blocks (useTrainingBlocks), so a recurring training routine never showed up
// here at all even though DayAgenda already projects it correctly. A
// recurring occurrence has no row of its own for a given day (it's derived,
// not stored), so it carries a reference to the REAL schedule_blocks row for
// editing instead of a synthetic time_blocks shape.
interface CalendarPlanItem {
  id:    string
  title: string
  kind:  'block' | 'recurring'
  timeBlock?:     TimeBlock
  scheduleBlock?: ScheduleBlock
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toDateStr(iso: string): string {
  return iso.slice(0, 10)
}

// Local YYYY-MM-DD (avoids the UTC shift that toISOString would introduce)
const ymd = formatLocalDate

// A planned session's tone relative to today: due today, upcoming, or a past
// plan that never became a workout. A logged workout is `success`.
function planTone(dateStr: string, todayStr: string): Tone {
  if (dateStr === todayStr) return 'warn'
  return dateStr > todayStr ? 'info' : 'danger'
}
const WORKOUT_TONE: Tone = 'success'

function StravaDot({ className = 'h-2 w-2' }: { className?: string }) {
  return <span aria-hidden className={`inline-block shrink-0 rounded-full ${className}`} style={{ backgroundColor: STRAVA_ORANGE }} />
}

// The day a workout was actually performed (session start), falling back to
// the Hevy record creation time only when start_time is missing.
function workoutDay(w: HevyWorkout): string {
  return toDateStr(w.start_time ?? w.hevy_created_at)
}

function getMondayOfWeek(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
}

function formatDayLabel(date: Date): string {
  return date.toLocaleDateString('en-GB', { weekday: 'short' })
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
}

function getWorkoutDuration(w: HevyWorkout): number | null {
  if (!w.start_time || !w.end_time) return null
  const diff = new Date(w.end_time).getTime() - new Date(w.start_time).getTime()
  return Math.round(diff / 60_000)
}

function formatDistance(meters: number | null): string {
  if (!meters) return ''
  if (meters >= 1000) return ` ${(meters / 1000).toFixed(1)} km`
  return ` ${meters} m`
}

function CalendarLegend() {
  const items: { tone?: Tone; label: string }[] = [
    { tone: 'warn', label: 'Plan today' },
    { tone: 'info', label: 'Plan upcoming' },
    { tone: 'danger', label: 'Plan missed' },
    { tone: WORKOUT_TONE, label: 'Workout' },
    { label: 'Strava' },
  ]
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-meta text-fg-muted">
      {items.map(i => (
        <span key={i.label} className="flex items-center gap-1.5">
          {i.tone ? <ToneDot tone={i.tone} /> : <StravaDot />} {i.label}
        </span>
      ))}
    </div>
  )
}

function CalViewToggle({ value, onChange }: { value: 'week' | 'month'; onChange: (v: 'week' | 'month') => void }) {
  return (
    <SegmentedControl<'week' | 'month'>
      size="sm"
      value={value}
      onChange={onChange}
      options={[{ value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }]}
    />
  )
}

// ─── Week View ────────────────────────────────────────────────────────────────

interface DayData {
  date: Date
  workouts: HevyWorkout[]
  activities: StravaActivity[]
  plans: CalendarPlanItem[]
}

interface DayCellProps {
  day: DayData
  isToday: boolean
  selectedDate: string | null
  todayStr: string
  onSelect: (d: string) => void
  onOpenWorkout: (id: string) => void
  onOpenPlan: (p: CalendarPlanItem) => void
}

function WeekDayCell({ day, isToday, selectedDate, todayStr, onSelect, onOpenWorkout, onOpenPlan }: DayCellProps) {
  const dateStr = ymd(day.date)
  const isSelected = selectedDate === dateStr

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
      className={`flex min-h-[76px] w-[92px] flex-shrink-0 cursor-pointer snap-start flex-col items-stretch gap-1.5 rounded-row border p-1.5 transition-colors sm:w-auto sm:flex-shrink ${
        isSelected
          ? 'border-accent-500 bg-accent-50'
          : 'border-line bg-surface hover:border-line-strong hover:bg-surface-hover'
      }`}
      onClick={() => onSelect(isSelected ? '' : dateStr)}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(isSelected ? '' : dateStr) } }}
    >
      <div className="flex flex-col items-center gap-0.5">
        <span className="text-micro font-semibold uppercase tracking-[0.06em] text-fg-muted">{formatDayLabel(day.date)}</span>
        <span className={`flex h-7 w-7 items-center justify-center rounded-full text-body font-bold tabular-nums ${
          isToday ? 'bg-accent-500 text-on-accent' : 'text-fg-2'
        }`}>
          {day.date.getDate()}
        </span>
      </div>

      <div className="flex flex-col gap-1">
        {day.plans.map(p => (
          <button
            key={p.id}
            type="button"
            onClick={e => { e.stopPropagation(); onOpenPlan(p) }}
            className="flex items-center gap-1 truncate rounded bg-surface-2 px-1.5 py-0.5 text-left text-micro font-medium leading-tight text-fg-2 transition-colors hover:bg-surface-hover"
            title={`${p.kind === 'recurring' ? 'Recurring plan' : 'Planned'}: ${p.title} — click to edit`}
          >
            <ToneDot tone={planTone(dateStr, todayStr)} className="!h-1.5 !w-1.5" />
            <span className="truncate">{p.kind === 'recurring' && '⟳ '}{p.title}</span>
          </button>
        ))}

        {day.workouts.map(w => {
          const dur = getWorkoutDuration(w)
          return (
            <button
              key={w.id}
              type="button"
              onClick={e => { e.stopPropagation(); onOpenWorkout(w.id) }}
              className="flex items-center gap-1 truncate rounded bg-surface-2 px-1.5 py-0.5 text-left text-micro font-medium leading-tight text-fg transition-colors hover:bg-surface-hover"
              title={`${w.title} — view details`}
            >
              <ToneDot tone={WORKOUT_TONE} className="!h-1.5 !w-1.5" />
              <span className="truncate">{w.title}{dur ? ` · ${dur}m` : ''}</span>
            </button>
          )
        })}

        {day.activities.map(a => (
          <div
            key={a.id}
            className="flex items-center gap-1 truncate rounded bg-surface-2 px-1.5 py-0.5 text-micro font-medium leading-tight text-fg-2"
            title={a.title}
          >
            <StravaDot className="h-1.5 w-1.5" />
            <StravaTypeIcon type={a.type} className="h-3 w-3 shrink-0" />
            <span className="truncate">{formatDistance(a.distance_meters)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

interface SelectedDay {
  date:       Date
  workouts:   HevyWorkout[]
  activities: StravaActivity[]
  plans:      CalendarPlanItem[]
}

// Shared by WeekView and MonthView — was pixel-for-pixel duplicated in both.
function DayDetailPanel({
  selectedDay, dateKey, todayStr, onOpenWorkout, onOpenPlan,
}: {
  selectedDay:   SelectedDay | null | undefined
  dateKey:       string
  todayStr:      string
  onOpenWorkout: (id: string) => void
  onOpenPlan:    (p: CalendarPlanItem) => void
}) {
  if (!selectedDay || (selectedDay.workouts.length === 0 && selectedDay.activities.length === 0 && selectedDay.plans.length === 0)) {
    return null
  }

  return (
    <div className="flex flex-col gap-3 border-t border-line pt-3">
      <p className="text-body font-semibold text-fg">
        {selectedDay.date.toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'long' })}
      </p>

      {selectedDay.plans.length > 0 && (
        <div>
          <p className="section-label mb-1.5">Planned</p>
          <div className="flex flex-col gap-1">
            {selectedDay.plans.map(p => (
              <button key={p.id} type="button" onClick={() => onOpenPlan(p)} className="row row-interactive w-full border border-line text-left">
                <ToneDot tone={planTone(dateKey, todayStr)} />
                <span className="text-body font-medium text-fg">{p.kind === 'recurring' && '⟳ '}{p.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {selectedDay.workouts.length > 0 && (
        <div>
          <p className="section-label mb-1.5">Hevy workouts</p>
          <div className="flex flex-col gap-1">
            {selectedDay.workouts.map(w => {
              const dur = getWorkoutDuration(w)
              return (
                <button key={w.id} type="button" onClick={() => onOpenWorkout(w.id)} className="row row-interactive w-full border border-line text-left">
                  <ToneDot tone={WORKOUT_TONE} />
                  <span className="flex-1 text-body font-medium text-fg">{w.title}</span>
                  {dur && <span className="shrink-0 text-meta tabular-nums text-fg-muted">{dur} min</span>}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {selectedDay.activities.length > 0 && (
        <div>
          <p className="section-label mb-1.5">Strava</p>
          <div className="flex flex-col gap-1">
            {selectedDay.activities.map(a => (
              <div key={a.id} className="row border border-line">
                <StravaDot />
                <StravaTypeIcon type={a.type} className="h-4 w-4 shrink-0 text-fg-muted" />
                <span className="flex-1 text-body font-medium text-fg">{a.title}</span>
                {a.distance_meters && (
                  <span className="shrink-0 text-meta tabular-nums text-fg-muted">{(a.distance_meters / 1000).toFixed(2)} km</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

interface WeekViewProps {
  weekStart: Date
  workouts: HevyWorkout[]
  activities: StravaActivity[]
  plansByDate: Map<string, CalendarPlanItem[]>
  todayStr: string
  today: Date
  onPrev: () => void
  onNext: () => void
  onToday: () => void
  onSwitchToMonth: () => void
  onOpenWorkout: (id: string) => void
  onOpenPlan: (p: CalendarPlanItem) => void
}

function WeekView({ weekStart, workouts, activities, plansByDate, todayStr, today, onPrev, onNext, onToday, onSwitchToMonth, onOpenWorkout, onOpenPlan }: WeekViewProps) {
  // Today's detail panel is expanded by default (no click needed) so the
  // day's plan/workouts/activities flow visibly below the grid on load.
  const [selectedDate, setSelectedDate] = useState<string | null>(todayStr)

  const days: DayData[] = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const date = addDays(weekStart, i)
      const dateStr = ymd(date)
      return {
        date,
        workouts: workouts.filter(w => workoutDay(w) === dateStr),
        activities: activities.filter(a => a.start_date && toDateStr(a.start_date) === dateStr),
        plans: plansByDate.get(dateStr) ?? [],
      }
    })
  }, [weekStart, workouts, activities, plansByDate])

  const weekLabel = `${formatDate(weekStart)} – ${formatDate(addDays(weekStart, 6))}`

  const selectedDay = selectedDate
    ? days.find(d => ymd(d.date) === selectedDate)
    : null

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        {/* App-standard ‹ label › date navigation (shared DateNav) */}
        <DateNav
          size="md"
          label={weekLabel}
          labelClassName="min-w-[150px] text-body font-semibold text-fg"
          onPrev={onPrev}
          onNext={onNext}
          onToday={onToday}
          isToday={false}
        />
        <CalViewToggle value="week" onChange={v => { if (v === 'month') onSwitchToMonth() }} />
      </div>

      {/* Below sm a 7-col grid squeezes each day to ~43px, so the week becomes
          a scrollable strip of readable fixed-width day cards. */}
      <div className="scroll-x flex snap-x snap-mandatory gap-1.5 pb-1 sm:grid sm:grid-cols-7 sm:overflow-visible sm:pb-0">
        {days.map(day => (
          <WeekDayCell
            key={day.date.toISOString()}
            day={day}
            isToday={isSameDay(day.date, today)}
            selectedDate={selectedDate}
            todayStr={todayStr}
            onSelect={setSelectedDate}
            onOpenWorkout={onOpenWorkout}
            onOpenPlan={onOpenPlan}
          />
        ))}
      </div>

      {/* Detail panel */}
      <DayDetailPanel
        selectedDay={selectedDay}
        dateKey={selectedDay ? ymd(selectedDay.date) : ''}
        todayStr={todayStr}
        onOpenWorkout={onOpenWorkout}
        onOpenPlan={onOpenPlan}
      />
    </div>
  )
}

// ─── Month View ───────────────────────────────────────────────────────────────

interface MonthViewProps {
  year: number
  month: number   // 0-based
  workouts: HevyWorkout[]
  activities: StravaActivity[]
  plansByDate: Map<string, CalendarPlanItem[]>
  todayStr: string
  today: Date
  onPrevMonth: () => void
  onNextMonth: () => void
  onToday: () => void
  onSwitchToWeek: () => void
  onOpenWorkout: (id: string) => void
  onOpenPlan: (p: CalendarPlanItem) => void
}

function MonthView({ year, month, workouts, activities, plansByDate, todayStr, today, onPrevMonth, onNextMonth, onToday, onSwitchToWeek, onOpenWorkout, onOpenPlan }: MonthViewProps) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null)

  const { cells, monthLabel } = useMemo(() => {
    const first = new Date(year, month, 1)
    const monthLabel = first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })

    // Mon-start: 0=Mon … 6=Sun
    const startDow = (first.getDay() + 6) % 7
    const daysInMonth = new Date(year, month + 1, 0).getDate()

    // build cells array, pad with nulls at start
    const cells: (Date | null)[] = [
      ...Array(startDow).fill(null),
      ...Array.from({ length: daysInMonth }, (_, i) => new Date(year, month, i + 1)),
    ]
    // pad end to complete last row
    while (cells.length % 7 !== 0) cells.push(null)
    return { cells, monthLabel }
  }, [year, month])

  const workoutDates = useMemo(() => new Set(workouts.map(workoutDay)), [workouts])
  const activityDates = useMemo(() => new Set(activities.filter(a => a.start_date).map(a => toDateStr(a.start_date!))), [activities])

  const selectedDay = useMemo(() => {
    if (!selectedDate) return null
    return {
      date: new Date(selectedDate + 'T12:00:00'),
      workouts: workouts.filter(w => workoutDay(w) === selectedDate),
      activities: activities.filter(a => a.start_date && toDateStr(a.start_date) === selectedDate),
      plans: plansByDate.get(selectedDate) ?? [],
    }
  }, [selectedDate, workouts, activities, plansByDate])

  const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        {/* App-standard ‹ label › date navigation (shared DateNav) */}
        <DateNav
          size="md"
          label={monthLabel}
          labelClassName="min-w-[150px] text-body font-semibold text-fg"
          onPrev={onPrevMonth}
          onNext={onNextMonth}
          onToday={onToday}
          isToday={false}
        />
        <CalViewToggle value="month" onChange={v => { if (v === 'week') onSwitchToWeek() }} />
      </div>

      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 gap-1">
        {DAY_LABELS.map(d => (
          <div key={d} className="py-1 text-center text-micro font-semibold uppercase tracking-[0.06em] text-fg-muted">{d}</div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-1">
        {cells.map((date, idx) => {
          if (!date) {
            return <div key={`empty-${idx}`} className="aspect-square" />
          }
          const dateStr = ymd(date)
          const hasWorkout = workoutDates.has(dateStr)
          const hasActivity = activityDates.has(dateStr)
          const hasPlan = plansByDate.has(dateStr)
          const isToday = isSameDay(date, today)
          const isSelected = selectedDate === dateStr

          return (
            <button
              key={dateStr}
              type="button"
              onClick={() => setSelectedDate(isSelected ? null : dateStr)}
              aria-pressed={isSelected}
              className={`flex aspect-square min-h-[44px] flex-col items-center justify-start rounded-control border pt-1 transition-colors ${
                isSelected
                  ? 'border-accent-500 bg-accent-50'
                  : 'border-transparent hover:border-line hover:bg-surface-hover'
              }`}
            >
              <span className={`grid h-6 w-6 place-items-center rounded-full text-meta font-semibold tabular-nums ${
                isToday ? 'bg-accent-500 text-on-accent' : 'text-fg-2'
              }`}>
                {date.getDate()}
              </span>
              <div className="mt-0.5 flex gap-0.5">
                {hasPlan && <ToneDot tone={planTone(dateStr, todayStr)} className="!h-1.5 !w-1.5" />}
                {hasWorkout && <ToneDot tone={WORKOUT_TONE} className="!h-1.5 !w-1.5" />}
                {hasActivity && <StravaDot className="h-1.5 w-1.5" />}
              </div>
            </button>
          )
        })}
      </div>

      {/* Legend */}
      <CalendarLegend />

      {/* Day detail */}
      <DayDetailPanel
        selectedDay={selectedDay}
        dateKey={selectedDate ?? ''}
        todayStr={todayStr}
        onOpenWorkout={onOpenWorkout}
        onOpenPlan={onOpenPlan}
      />
    </div>
  )
}

// ─── TrainingCalendar (top-level) ─────────────────────────────────────────────

type CalView = 'week' | 'month'

export function TrainingCalendar() {
  const today = useMemo(() => { const d = new Date(); d.setHours(0,0,0,0); return d }, [])
  const [view, setView] = useState<CalView>('week')
  const [weekStart, setWeekStart] = useState<Date>(() => getMondayOfWeek(today))
  const [monthYear, setMonthYear] = useState<{ year: number; month: number }>(() => ({
    year: today.getFullYear(),
    month: today.getMonth(),
  }))

  // A task-linked plan block must open the TASK, never the block via
  // `timeBlock` (that minted a second task — the real duplicate-task bug).
  // The shared block editor applies that routing rule once for every caller;
  // a recurring occurrence opens its template (it can never be task-linked).
  const modal = useEntityModal()
  const openPlan = useCallback((item: CalendarPlanItem) => {
    if (item.kind === 'recurring' && item.scheduleBlock) {
      modal.open({ kind: 'schedule-block', id: item.scheduleBlock.id, config: { heading: 'Edit recurring session' } })
    } else if (item.timeBlock) {
      modal.open({ kind: 'time-block', id: item.timeBlock.id, config: { heading: 'Edit session' } })
    }
  }, [modal])
  const openWorkout = useCallback((id: string) => modal.open({ kind: 'hevy-workout', id }), [modal])

  const { data: workouts = [] } = useHevyWorkouts({ limit: 200 })
  const { data: activities = [] } = useStravaActivities({ limit: 200 })

  // Visible date range for the current view → fetch planned training sessions.
  const { rangeFrom, rangeTo } = useMemo(() => {
    if (view === 'week') {
      return { rangeFrom: ymd(weekStart), rangeTo: ymd(addDays(weekStart, 6)) }
    }
    return {
      rangeFrom: ymd(new Date(monthYear.year, monthYear.month, 1)),
      rangeTo:   ymd(new Date(monthYear.year, monthYear.month + 1, 0)),
    }
  }, [view, weekStart, monthYear])

  const { data: planBlocks = [] } = useTrainingBlocks(rangeFrom, rangeTo)

  // Recurring training templates (e.g. "every Mon/Wed/Fri 16:30") — fetched
  // once (all schedule_blocks, cheap/small, cached 10min by useScheduleBlocks)
  // and PROJECTED onto the visible range below with the same pure helper
  // DayAgenda already uses. Real gap fixed: this calendar used to only ever
  // read one-off time_blocks (useTrainingBlocks), so a recurring routine
  // never showed up here at all even though it renders correctly on Daily.
  const { data: allScheduleBlocks = [] } = useScheduleBlocks()
  const trainingScheduleBlocks = useMemo(
    () => allScheduleBlocks.filter(b => b.category === 'training'),
    [allScheduleBlocks],
  )

  // date → planned training sessions for that day (one-off rows + projected
  // recurring occurrences, merged into one list).
  const plansByDate = useMemo(() => {
    const m = new Map<string, CalendarPlanItem[]>()

    for (const b of planBlocks) {
      const bucket = m.get(b.date) ?? []
      bucket.push({ id: b.id, title: b.title, kind: 'block', timeBlock: b })
      m.set(b.date, bucket)
    }

    if (trainingScheduleBlocks.length) {
      // Walk every date in the visible range once, day by day — cheap even
      // for a full month (≤31 iterations × a handful of templates).
      let cursor = new Date(`${rangeFrom}T00:00:00`)
      const end = new Date(`${rangeTo}T00:00:00`)
      while (cursor <= end) {
        const dateStr   = ymd(cursor)
        const dayOfWeek = cursor.getDay()
        for (const p of projectRecurringBlocksForDay(dateStr, dayOfWeek, trainingScheduleBlocks)) {
          // A spillover tail (a session crossing midnight) is DayAgenda's own
          // per-minute agenda concept — this calendar shows one entry per day
          // a session STARTS on, matching how a one-off block already behaves
          // here (no spillover duplication exists for those either).
          if (p.spillover) continue
          const scheduleBlock = trainingScheduleBlocks.find(s => s.id === p.canonicalId)
          if (!scheduleBlock) continue
          const bucket = m.get(dateStr) ?? []
          bucket.push({ id: `${p.canonicalId}__${dateStr}`, title: p.title, kind: 'recurring', scheduleBlock })
          m.set(dateStr, bucket)
        }
        cursor = addDays(cursor, 1)
      }
    }

    return m
  }, [planBlocks, trainingScheduleBlocks, rangeFrom, rangeTo])

  const todayStr = ymd(today)

  function handlePrevWeek() { setWeekStart(d => addDays(d, -7)) }
  function handleNextWeek() { setWeekStart(d => addDays(d, 7)) }
  function handleTodayWeek() { setWeekStart(getMondayOfWeek(today)) }

  function handlePrevMonth() {
    setMonthYear(({ year, month }) => month === 0
      ? { year: year - 1, month: 11 }
      : { year, month: month - 1 })
  }
  function handleNextMonth() {
    setMonthYear(({ year, month }) => month === 11
      ? { year: year + 1, month: 0 }
      : { year, month: month + 1 })
  }
  function handleTodayMonth() {
    setMonthYear({ year: today.getFullYear(), month: today.getMonth() })
  }

  return (
    <Card className="w-full">
      {view === 'week' ? (
        <WeekView
          weekStart={weekStart}
          workouts={workouts}
          activities={activities}
          plansByDate={plansByDate}
          todayStr={todayStr}
          today={today}
          onPrev={handlePrevWeek}
          onNext={handleNextWeek}
          onToday={handleTodayWeek}
          onSwitchToMonth={() => setView('month')}
          onOpenWorkout={openWorkout}
          onOpenPlan={openPlan}
        />
      ) : (
        <MonthView
          year={monthYear.year}
          month={monthYear.month}
          workouts={workouts}
          activities={activities}
          plansByDate={plansByDate}
          todayStr={todayStr}
          today={today}
          onPrevMonth={handlePrevMonth}
          onNextMonth={handleNextMonth}
          onToday={handleTodayMonth}
          onSwitchToWeek={() => setView('week')}
          onOpenWorkout={openWorkout}
          onOpenPlan={openPlan}
        />
      )}
    </Card>
  )
}
