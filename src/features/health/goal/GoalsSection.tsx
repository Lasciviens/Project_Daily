import { Pencil } from 'lucide-react'
import { Button, cx, type Tone } from '../../../shared/ui'
import { useEntityModal } from '../../../shared/modals/useEntityModal'
import { fmtDayMonth } from '../components/healthFormat'
import { noDateReason, type GoalProgress } from './bodyGoal'
import type { GoalReport } from './goalReport'
import type { GoalSettings } from './goalSettings'
import { GOAL_META, signed } from './goalCopy'
import { GoalBlock } from './GoalBlock'

const STATUS_TONE: Record<GoalProgress['status'], Tone> = {
  reached: 'success', moving_toward: 'success', moving_away: 'warn', flat: 'neutral', no_trend: 'neutral', no_data: 'neutral',
}
const BAR: Partial<Record<Tone, string>> = { success: 'bg-success', warn: 'bg-warn', neutral: 'bg-neutral' }

/** No date yet: the real change since the start and why there is no date. */
function flatLine(g: GoalProgress, unit: string): string {
  const why = noDateReason(g)
  if (!why) return 'No clear trend in this window yet.'
  const dp = GOAL_META[g.kind].dp
  const change = `${signed(why.change, dp, ` ${unit}`)} since ${fmtDayMonth(why.startDate)}`
  if (why.withinNoise) {
    const noise = g.kind === 'weight' ? `normal day-to-day swings (±${why.noise} ${unit})` : `the scale's ±${why.noise} ${unit} noise`
    return `${change} — smaller than ${noise}, so no date yet.`
  }
  if (why.direction === 'away') {
    const goingDown = why.change < 0
    return `${change} · going ${goingDown ? 'down' : 'up'} while the goal is ${goingDown ? 'up' : 'down'} · too noisy for a date yet.`
  }
  return `${change} · heading toward the goal, but too uneven for a date yet.`
}

function statusLine(g: GoalProgress, unit: string): string {
  const rate = g.perWeek != null ? `${signed(g.perWeek, 2)} ${unit}/week` : ''
  switch (g.status) {
    case 'reached': return 'Reached — hold it here.'
    case 'moving_toward':
      return g.eta === 'too_far' ? `${rate} — more than two years away at this pace.`
        : g.eta ? `${rate} → about ${fmtDayMonth(g.eta.date)} (${g.eta.days} days) if nothing changes.` : rate
    case 'moving_away': return `${rate} — moving away from the goal.`
    case 'flat': return flatLine(g, unit)
    case 'no_trend': return g.kind === 'weight' ? 'Needs 4+ weigh-ins over a week for a date.' : 'Needs 4+ readings over 14 days for a date.'
    case 'no_data': return g.kind === 'muscle' ? 'Needs a scale report with muscle % (phone shortcut).' : 'No readings yet.'
  }
}

function GoalRow({ g }: { g: GoalProgress }) {
  const m = GOAL_META[g.kind]
  const tone = STATUS_TONE[g.status]
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-row border border-line bg-surface p-3">
      <p className="text-meta text-fg-muted">{m.label} goal</p>
      <p className="text-lead tabular-nums text-fg">
        <strong>{g.current != null ? g.current.toFixed(m.dp) : '—'}</strong>
        <span className="text-fg-muted"> → {g.goal.toFixed(m.dp)} {m.unit}</span>
      </p>
      {g.progress != null && (
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-label={`${m.label} goal progress`}
          aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(g.progress * 100)}>
          <div className={cx('h-full rounded-full', BAR[tone] ?? 'bg-neutral')} style={{ width: `${Math.round(g.progress * 100)}%` }} />
        </div>
      )}
      <p className="text-meta text-fg-2">
        {g.remaining != null && g.status !== 'reached' && <span className="tabular-nums">{signed(g.remaining, m.dp, ` ${m.unit}`)} to go · </span>}
        {statusLine(g, m.unit)}
      </p>
      {g.start != null && g.startDate && (
        <p className="text-micro font-normal tabular-nums text-fg-muted">Started at {g.start.toFixed(m.dp)} {m.unit} ({fmtDayMonth(g.startDate)}) · {m.source}</p>
      )}
    </div>
  )
}

/** Progress toward each body target with a projected date. The targets are
 *  part of the one goal — "Edit goal" opens the shared goal editor. */
export function GoalsSection({ report, settings, fromDevice, card }: {
  report: GoalReport; settings: GoalSettings; fromDevice: boolean; card?: boolean
}) {
  const modal = useEntityModal()
  const rows = [report.goals.weight, report.goals.bodyFat, report.goals.muscle].filter((g): g is GoalProgress => g != null)
  return (
    <GoalBlock title="Body targets" card={card} action={(
      <Button variant="ghost" size="sm" icon={<Pencil className="h-4 w-4" aria-hidden />} onClick={() => modal.open({ kind: 'day-targets' })}>
        {rows.length || settings.phaseStartDate ? 'Edit goal' : 'Set body targets'}
      </Button>
    )}>
      {rows.length === 0 && (
        <p className="text-body text-fg-muted">Add a goal weight, body fat % or muscle mass to your goal to see progress and a projected date.</p>
      )}
      {rows.length > 0 && <div className="grid gap-2 @xl:grid-cols-3">{rows.map(g => <GoalRow key={g.kind} g={g} />)}</div>}
      <p className="text-meta text-fg-muted">
        {settings.phaseStartDate
          ? `Phase started ${fmtDayMonth(settings.phaseStartDate)} — progress is measured from there.`
          : 'Add the day this phase started to your goal to see progress from your starting point.'}
        {fromDevice && ' Some targets are stored on this device for now — saving your goal moves them to your account.'}
      </p>
    </GoalBlock>
  )
}
