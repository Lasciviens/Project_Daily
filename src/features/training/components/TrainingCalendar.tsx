import { useCallback, useState, useMemo, useEffect, useRef } from 'react'
import { CalendarPlus } from 'lucide-react'
import { useHevyWorkoutsRange } from '../hooks/useHevyWorkouts'
import { useStravaActivities } from '../hooks/useStravaActivities'
import { useTodayStr } from '../hooks/useTrainingSessions'
import { useTrainingBlocks, useScheduleBlocks } from '../../daily/hooks/useSchedule'
import { projectRecurringBlocksForDay } from '../../daily/components/dayAgendaProjection'
import { useEntityModal } from '../../../shared/modals'
import { DateNav } from '../../../shared/components/DateNav'
import { Button, Card, SegmentedControl, ToneDot, type Tone } from '../../../shared/ui'
import { STRAVA_ORANGE } from '../stravaMeta'
import { StravaTypeIcon } from './StravaIcons'
import { formatLocalDate, localDayOf } from '../../../shared/utils/dateUtils'
import { localDayBoundsIso, workoutLocalDay } from '../api/hevyApi'
import { PLAN_STATUS_LABEL, planStatus, type PlanStatus } from '../trainingPlanModel'
import { formatDistance } from '../setFormat'
import { openPlanSession } from '../planTraining'
import type { HevyWorkout, StravaActivity } from '../types.hevy'
import type { TimeBlock, ScheduleBlock } from '../../daily/types'
import { fmtDateEnGB } from '../../../shared/utils/enGBDate'

// A calendar "plan" entry is either a real one-off time_blocks row, or a
// PROJECTED occurrence of a recurring schedule_blocks template (e.g. "every
// Mon/Wed/Fri 16:30"), never projected before the template's effective_from
// (projectRecurringBlocksForDay). A recurring occurrence has no row of its
// own, so it carries the REAL schedule_blocks row for editing.
interface CalendarPlanItem {
  id:    string
  title: string
  kind:  'block' | 'recurring'
  timeBlock?:     TimeBlock
  scheduleBlock?: ScheduleBlock
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Local YYYY-MM-DD (avoids the UTC shift that toISOString would introduce)
const ymd = formatLocalDate

// A plan on a day that has a workout or a Strava activity is DONE — it used
// to show red "missed" right next to that day's green workout.
const PLAN_TONE: Record<PlanStatus, Tone> = { today: 'warn', upcoming: 'info', done: 'success', missed: 'danger' }
const WORKOUT_TONE: Tone = 'success'

function StravaDot({ className = 'h-2 w-2' }: { className?: string }) {
  return <span aria-hidden className={`inline-block shrink-0 rounded-full ${className}`} style={{ backgroundColor: STRAVA_ORANGE }} />
}

// Strava stores its UTC start; the day is the LOCAL day it started on.
function activityDay(a: StravaActivity): string | null {
  return localDayOf(a.start_date)
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
  return fmtDateEnGB(date, { day: '2-digit', month: 'short' })
}

/** Minutes, or null when unknown or zero (a 0-minute workout used to
 *  render a stray "0"). */
function getWorkoutDuration(w: HevyWorkout): number | null {
  if (!w.start_time || !w.end_time) return null
  const mins = Math.round((new Date(w.end_time).getTime() - new Date(w.start_time).getTime()) / 60_000)
  return mins > 0 ? mins : null
}

function CalendarLegend() {
  const items: { tone?: Tone; label: string }[] = [
    { tone: PLAN_TONE.today, label: PLAN_STATUS_LABEL.today },
    { tone: PLAN_TONE.upcoming, label: PLAN_STATUS_LABEL.upcoming },
    { tone: PLAN_TONE.done, label: PLAN_STATUS_LABEL.done },
    { tone: PLAN_TONE.missed, label: PLAN_STATUS_LABEL.missed },
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

function dayDataFor(dateStr: string, date: Date, workouts: HevyWorkout[], activities: StravaActivity[], plansByDate: Map<string, CalendarPlanItem[]>): DayData {
  return {
    date,
    workouts: workouts.filter(w => workoutLocalDay(w) === dateStr),
    activities: activities.filter(a => activityDay(a) === dateStr),
    plans: plansByDate.get(dateStr) ?? [],
  }
}

function statusOf(day: DayData, todayStr: string): PlanStatus {
  return planStatus(ymd(day.date), todayStr, day.workouts.length > 0 || day.activities.length > 0)
}

interface DayCellProps {
  day: DayData
  isToday: boolean
  isSelected: boolean
  todayStr: string
  onSelect: () => void
}

// One real <button> per day (select it); the plan/workout lines inside are
// labels, not buttons — nested controls inside a role=button were invalid
// and ~18px tall. The tappable 44px rows live in DayDetailPanel below.
function WeekDayCell({ day, isToday, isSelected, todayStr, onSelect }: DayCellProps) {
  const cellRef = useRef<HTMLButtonElement>(null)
  const tone = PLAN_TONE[statusOf(day, todayStr)]

  // Phones show the week as a scrolling strip: bring the selected day (today
  // on first render) into view horizontally, without scrolling the page.
  useEffect(() => {
    const el = cellRef.current
    const strip = el?.parentElement
    if (!isSelected || !el || !strip || strip.scrollWidth <= strip.clientWidth) return
    strip.scrollLeft = el.offsetLeft - strip.offsetLeft - (strip.clientWidth - el.offsetWidth) / 2
  }, [isSelected])

  return (
    <button
      ref={cellRef}
      type="button"
      aria-pressed={isSelected}
      onClick={onSelect}
      className={`flex min-h-[76px] w-[92px] flex-shrink-0 snap-start flex-col items-stretch gap-1.5 rounded-row border p-1.5 text-left transition-colors sm:w-auto sm:flex-shrink ${
        isSelected
          ? 'border-accent-500 bg-accent-50'
          : 'border-line bg-surface hover:border-line-strong hover:bg-surface-hover'
      }`}
    >
      <span className="flex flex-col items-center gap-0.5">
        <span className="text-micro font-semibold uppercase tracking-[0.06em] text-fg-muted">{day.date.toLocaleDateString('en-GB', { weekday: 'short' })}</span>
        <span className={`flex h-7 w-7 items-center justify-center rounded-full text-body font-bold tabular-nums ${
          isToday ? 'bg-accent-500 text-on-accent' : 'text-fg-2'
        }`}>
          {day.date.getDate()}
        </span>
      </span>

      <span className="flex flex-col gap-1">
        {day.plans.map(p => (
          <span key={p.id} className="flex items-center gap-1 truncate rounded bg-surface-2 px-1.5 py-0.5 text-micro font-medium leading-tight text-fg-2">
            <ToneDot tone={tone} className="!h-1.5 !w-1.5" />
            <span className="truncate">{p.kind === 'recurring' && '⟳ '}{p.title}</span>
          </span>
        ))}
        {day.workouts.map(w => {
          const dur = getWorkoutDuration(w)
          return (
            <span key={w.id} className="flex items-center gap-1 truncate rounded bg-surface-2 px-1.5 py-0.5 text-micro font-medium leading-tight text-fg">
              <ToneDot tone={WORKOUT_TONE} className="!h-1.5 !w-1.5" />
              <span className="truncate">{w.title}{dur != null ? ` · ${dur}m` : ''}</span>
            </span>
          )
        })}
        {day.activities.map(a => (
          <span key={a.id} className="flex items-center gap-1 truncate rounded bg-surface-2 px-1.5 py-0.5 text-micro font-medium leading-tight text-fg-2" title={a.title}>
            <StravaDot className="h-1.5 w-1.5" />
            <StravaTypeIcon type={a.type} className="h-3 w-3 shrink-0" />
            <span className="truncate">{a.distance_meters ? formatDistance(a.distance_meters) : a.title}</span>
          </span>
        ))}
      </span>
    </button>
  )
}

// Shared by WeekView and MonthView.
function DayDetailPanel({
  day, todayStr, onOpenWorkout, onOpenPlan,
}: {
  day:           DayData | null | undefined
  todayStr:      string
  onOpenWorkout: (id: string) => void
  onOpenPlan:    (p: CalendarPlanItem) => void
}) {
  if (!day) return null
  const dateKey = ymd(day.date)
  const empty = day.workouts.length === 0 && day.activities.length === 0 && day.plans.length === 0
  const canPlan = dateKey >= todayStr
  if (empty && !canPlan) return null
  const status = statusOf(day, todayStr)

  return (
    <div className="flex flex-col gap-3 border-t border-line pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-body font-semibold text-fg">
          {day.date.toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'long' })}
        </p>
        {canPlan && (
          <Button size="sm" icon={<CalendarPlus />} onClick={() => openPlanSession(dateKey)}>Plan a session</Button>
        )}
      </div>

      {day.plans.length > 0 && (
        <div>
          <p className="section-label mb-1.5">Planned</p>
          <div className="flex flex-col gap-1">
            {day.plans.map(p => (
              <button key={p.id} type="button" onClick={() => onOpenPlan(p)} className="row row-interactive w-full border border-line text-left">
                <ToneDot tone={PLAN_TONE[status]} />
                <span className="flex-1 text-body font-medium text-fg">{p.kind === 'recurring' && '⟳ '}{p.title}</span>
                <span className="shrink-0 text-meta text-fg-muted">{PLAN_STATUS_LABEL[status].replace('Plan ', '')}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {day.workouts.length > 0 && (
        <div>
          <p className="section-label mb-1.5">Hevy workouts</p>
          <div className="flex flex-col gap-1">
            {day.workouts.map(w => {
              const dur = getWorkoutDuration(w)
              return (
                <button key={w.id} type="button" onClick={() => onOpenWorkout(w.id)} className="row row-interactive w-full border border-line text-left">
                  <ToneDot tone={WORKOUT_TONE} />
                  <span className="flex-1 text-body font-medium text-fg">{w.title}</span>
                  {dur != null && <span className="shrink-0 text-meta tabular-nums text-fg-muted">{dur} min</span>}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {day.activities.length > 0 && (
        <div>
          <p className="section-label mb-1.5">Strava</p>
          <div className="flex flex-col gap-1">
            {day.activities.map(a => (
              <div key={a.id} className="row border border-line">
                <StravaDot />
                <StravaTypeIcon type={a.type} className="h-4 w-4 shrink-0 text-fg-muted" />
                <span className="flex-1 text-body font-medium text-fg">{a.title}</span>
                {a.distance_meters ? <span className="shrink-0 text-meta tabular-nums text-fg-muted">{formatDistance(a.distance_meters)}</span> : null}
              </div>
            ))}
          </div>
        </div>
      )}

      {empty && <p className="text-meta text-fg-muted">Nothing planned or logged.</p>}
    </div>
  )
}

interface ViewProps {
  workouts: HevyWorkout[]
  activities: StravaActivity[]
  plansByDate: Map<string, CalendarPlanItem[]>
  todayStr: string
  onPrev: () => void
  onNext: () => void
  onToday: () => void
  onSwitchView: () => void
  onOpenWorkout: (id: string) => void
  onOpenPlan: (p: CalendarPlanItem) => void
}

function WeekView({ weekStart, workouts, activities, plansByDate, todayStr, onPrev, onNext, onToday, onSwitchView, onOpenWorkout, onOpenPlan }: ViewProps & { weekStart: Date }) {
  // Today's detail panel is open by default so the day's plan/workouts show
  // below the grid on load.
  const [selectedDate, setSelectedDate] = useState<string | null>(todayStr)

  const days: DayData[] = useMemo(() => Array.from({ length: 7 }, (_, i) => {
    const date = addDays(weekStart, i)
    return dayDataFor(ymd(date), date, workouts, activities, plansByDate)
  }), [weekStart, workouts, activities, plansByDate])

  const weekLabel = `${formatDate(weekStart)} – ${formatDate(addDays(weekStart, 6))}`
  const selectedDay = selectedDate ? days.find(d => ymd(d.date) === selectedDate) : null

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <DateNav size="md" label={weekLabel} labelClassName="min-w-[150px] text-body font-semibold text-fg" onPrev={onPrev} onNext={onNext} onToday={onToday} isToday={false} />
        <CalViewToggle value="week" onChange={v => { if (v === 'month') onSwitchView() }} />
      </div>

      {/* Below sm a 7-col grid squeezes each day to ~43px, so the week becomes
          a scrollable strip of readable fixed-width day cards. */}
      <div className="scroll-x flex snap-x snap-mandatory gap-1.5 pb-1 sm:grid sm:grid-cols-7 sm:overflow-visible sm:pb-0">
        {days.map(day => {
          const key = ymd(day.date)
          return (
            <WeekDayCell
              key={key}
              day={day}
              isToday={key === todayStr}
              isSelected={selectedDate === key}
              todayStr={todayStr}
              onSelect={() => setSelectedDate(selectedDate === key ? null : key)}
            />
          )
        })}
      </div>

      <CalendarLegend />
      <DayDetailPanel day={selectedDay} todayStr={todayStr} onOpenWorkout={onOpenWorkout} onOpenPlan={onOpenPlan} />
    </div>
  )
}

// ─── Month View ───────────────────────────────────────────────────────────────

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function MonthView({ year, month, workouts, activities, plansByDate, todayStr, onPrev, onNext, onToday, onSwitchView, onOpenWorkout, onOpenPlan }: ViewProps & { year: number; month: number }) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null)

  const { cells, monthLabel } = useMemo(() => {
    const first = new Date(year, month, 1)
    const monthLabel = first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
    const startDow = (first.getDay() + 6) % 7 // Mon-start: 0=Mon … 6=Sun
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const cells: (Date | null)[] = [
      ...Array(startDow).fill(null),
      ...Array.from({ length: daysInMonth }, (_, i) => new Date(year, month, i + 1)),
    ]
    while (cells.length % 7 !== 0) cells.push(null)
    return { cells, monthLabel }
  }, [year, month])

  const workoutDates = useMemo(() => new Set(workouts.map(workoutLocalDay)), [workouts])
  const activityDates = useMemo(() => new Set(activities.map(activityDay).filter(Boolean) as string[]), [activities])

  const selectedDay = useMemo(() => selectedDate
    ? dayDataFor(selectedDate, new Date(`${selectedDate}T12:00:00`), workouts, activities, plansByDate)
    : null, [selectedDate, workouts, activities, plansByDate])

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <DateNav size="md" label={monthLabel} labelClassName="min-w-[150px] text-body font-semibold text-fg" onPrev={onPrev} onNext={onNext} onToday={onToday} isToday={false} />
        <CalViewToggle value="month" onChange={v => { if (v === 'week') onSwitchView() }} />
      </div>

      <div className="grid grid-cols-7 gap-1">
        {DAY_LABELS.map(d => (
          <div key={d} className="py-1 text-center text-micro font-semibold uppercase tracking-[0.06em] text-fg-muted">{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((date, idx) => {
          if (!date) return <div key={`empty-${idx}`} className="aspect-square" />
          const dateStr = ymd(date)
          const hasWorkout = workoutDates.has(dateStr)
          const hasActivity = activityDates.has(dateStr)
          const hasPlan = plansByDate.has(dateStr)
          const isSelected = selectedDate === dateStr
          const tone = PLAN_TONE[planStatus(dateStr, todayStr, hasWorkout || hasActivity)]
          return (
            <button
              key={dateStr}
              type="button"
              onClick={() => setSelectedDate(isSelected ? null : dateStr)}
              aria-pressed={isSelected}
              aria-label={date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
              className={`flex aspect-square min-h-[44px] flex-col items-center justify-start rounded-control border pt-1 transition-colors ${
                isSelected ? 'border-accent-500 bg-accent-50' : 'border-transparent hover:border-line hover:bg-surface-hover'
              }`}
            >
              <span className={`grid h-6 w-6 place-items-center rounded-full text-meta font-semibold tabular-nums ${
                dateStr === todayStr ? 'bg-accent-500 text-on-accent' : 'text-fg-2'
              }`}>
                {date.getDate()}
              </span>
              <span className="mt-0.5 flex gap-0.5">
                {hasPlan && <ToneDot tone={tone} className="!h-1.5 !w-1.5" />}
                {hasWorkout && <ToneDot tone={WORKOUT_TONE} className="!h-1.5 !w-1.5" />}
                {hasActivity && <StravaDot className="h-1.5 w-1.5" />}
              </span>
            </button>
          )
        })}
      </div>

      <CalendarLegend />
      <DayDetailPanel day={selectedDay} todayStr={todayStr} onOpenWorkout={onOpenWorkout} onOpenPlan={onOpenPlan} />
    </div>
  )
}

// ─── TrainingCalendar (top-level) ─────────────────────────────────────────────

type CalView = 'week' | 'month'

export function TrainingCalendar() {
  // Kept current across midnight (a PWA left open overnight kept yesterday).
  const todayStr = useTodayStr()
  const today = useMemo(() => new Date(`${todayStr}T00:00:00`), [todayStr])
  const [view, setView] = useState<CalView>('week')
  const [weekStart, setWeekStart] = useState<Date>(() => getMondayOfWeek(new Date()))
  const [monthYear, setMonthYear] = useState<{ year: number; month: number }>(() => ({
    year: new Date().getFullYear(),
    month: new Date().getMonth(),
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

  // The visible range drives EVERY read — workouts and Strava too, which
  // used to be "the latest 200", so older months looked empty.
  const { rangeFrom, rangeTo } = useMemo(() => {
    if (view === 'week') return { rangeFrom: ymd(weekStart), rangeTo: ymd(addDays(weekStart, 6)) }
    return {
      rangeFrom: ymd(new Date(monthYear.year, monthYear.month, 1)),
      rangeTo:   ymd(new Date(monthYear.year, monthYear.month + 1, 0)),
    }
  }, [view, weekStart, monthYear])
  const bounds = useMemo(() => localDayBoundsIso(rangeFrom, rangeTo), [rangeFrom, rangeTo])

  const { data: workouts = [] } = useHevyWorkoutsRange(rangeFrom, rangeTo)
  const { data: activities = [] } = useStravaActivities({ from: bounds.fromISO, to: bounds.toISO, limit: 500 })
  const { data: planBlocks = [] } = useTrainingBlocks(rangeFrom, rangeTo)

  // Recurring training templates, projected onto the visible range with the
  // same pure helper DayAgenda uses.
  const { data: allScheduleBlocks = [] } = useScheduleBlocks()
  const trainingScheduleBlocks = useMemo(() => allScheduleBlocks.filter(b => b.category === 'training'), [allScheduleBlocks])

  const plansByDate = useMemo(() => {
    const m = new Map<string, CalendarPlanItem[]>()
    const push = (date: string, item: CalendarPlanItem) => m.set(date, [...(m.get(date) ?? []), item])

    for (const b of planBlocks) push(b.date, { id: b.id, title: b.title, kind: 'block', timeBlock: b })

    if (trainingScheduleBlocks.length) {
      for (let cursor = new Date(`${rangeFrom}T00:00:00`); ymd(cursor) <= rangeTo; cursor = addDays(cursor, 1)) {
        const dateStr = ymd(cursor)
        for (const p of projectRecurringBlocksForDay(dateStr, cursor.getDay(), trainingScheduleBlocks)) {
          // One entry per day a session STARTS on (a one-off block has no
          // spillover row here either).
          if (p.spillover) continue
          const scheduleBlock = trainingScheduleBlocks.find(s => s.id === p.canonicalId)
          if (scheduleBlock) push(dateStr, { id: `${p.canonicalId}__${dateStr}`, title: p.title, kind: 'recurring', scheduleBlock })
        }
      }
    }
    return m
  }, [planBlocks, trainingScheduleBlocks, rangeFrom, rangeTo])

  const shared = { workouts, activities, plansByDate, todayStr, onOpenWorkout: openWorkout, onOpenPlan: openPlan }

  return (
    <Card className="w-full">
      {view === 'week' ? (
        <WeekView
          {...shared}
          weekStart={weekStart}
          onPrev={() => setWeekStart(d => addDays(d, -7))}
          onNext={() => setWeekStart(d => addDays(d, 7))}
          onToday={() => setWeekStart(getMondayOfWeek(today))}
          onSwitchView={() => setView('month')}
        />
      ) : (
        <MonthView
          {...shared}
          year={monthYear.year}
          month={monthYear.month}
          onPrev={() => setMonthYear(({ year, month }) => (month === 0 ? { year: year - 1, month: 11 } : { year, month: month - 1 }))}
          onNext={() => setMonthYear(({ year, month }) => (month === 11 ? { year: year + 1, month: 0 } : { year, month: month + 1 }))}
          onToday={() => setMonthYear({ year: today.getFullYear(), month: today.getMonth() })}
          onSwitchView={() => setView('week')}
        />
      )}
    </Card>
  )
}
