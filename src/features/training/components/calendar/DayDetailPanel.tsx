import { CalendarPlus } from 'lucide-react'
import { Button, ToneDot } from '../../../../shared/ui'
import { PLAN_STATUS_LABEL } from '../../trainingPlanModel'
import { formatDistance } from '../../setFormat'
import { openPlanSession } from '../../planTraining'
import { StravaTypeIcon } from '../StravaIcons'
import { StravaDot } from './CalendarBits'
import { PLAN_TONE, WORKOUT_TONE, getWorkoutDuration, statusOf, ymd, type CalendarPlanItem, type DayData } from './calendarModel'

// Shared by WeekView and MonthView.
export function DayDetailPanel({
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

