import { SegmentedControl, ToneDot, type Tone } from '../../../../shared/ui'
import { STRAVA_ORANGE } from '../../stravaMeta'
import { PLAN_STATUS_LABEL } from '../../trainingPlanModel'
import { PLAN_TONE, WORKOUT_TONE } from './calendarModel'

export function StravaDot({ className = 'h-2 w-2' }: { className?: string }) {
  return <span aria-hidden className={`inline-block shrink-0 rounded-full ${className}`} style={{ backgroundColor: STRAVA_ORANGE }} />
}

export function CalendarLegend() {
  const items: { tone?: Tone; label: string }[] = [
    { tone: PLAN_TONE.today, label: PLAN_STATUS_LABEL.today },
    { tone: PLAN_TONE.upcoming, label: PLAN_STATUS_LABEL.upcoming },
    { tone: PLAN_TONE.missed, label: PLAN_STATUS_LABEL.missed },
    // A covered plan folds into its workout, so green reads "done" for both.
    { tone: WORKOUT_TONE, label: 'Done' },
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

export function CalViewToggle({ value, onChange }: { value: 'week' | 'month'; onChange: (v: 'week' | 'month') => void }) {
  return (
    <SegmentedControl<'week' | 'month'>
      size="sm"
      value={value}
      onChange={onChange}
      options={[{ value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }]}
    />
  )
}

