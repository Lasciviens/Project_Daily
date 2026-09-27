import { useState } from 'react'
import { ChevronDown, Target } from 'lucide-react'
import { Card, CardHeader, SkeletonText, cx } from '../../../shared/ui'
import { InfoBubble } from '../../../shared/components/InfoBubble'
import { ErrorBoundary } from '../../../shared/components/ErrorBoundary'
import { fmtDayMonth } from '../components/healthFormat'
import { useGoalReport, type GoalWindow } from './useGoalReport'
import { usePhase } from './useBodyGoals'
import { PHASE_QUESTION, verdictCopy } from './goalCopy'
import { PhaseBar } from './PhaseBar'
import { GoalPathPanel } from './GoalPathPanel'
import { PaceSection } from './PaceSection'
import { CompositionSection } from './CompositionSection'
import { GoalsSection } from './GoalsSection'
import { ProteinBlock } from './ProteinBlock'
import { WeightTrendChart } from './WeightTrendChart'
import { EnergyVerdict } from './EnergyVerdict'
import { EnergyGrid } from './EnergyGrid'

/** "Am I doing this right?" for the phase the person picked (cut, maintain,
 *  gain): pace vs the science-based range, fat vs muscle from the scale,
 *  progress toward their body goals, and calories vs the scale. Reads its
 *  own data; no props. */
export function GoalReportCard() {
  const [win, setWin] = useState<`${GoalWindow}`>('28')
  const phase = usePhase()
  return (
    <Card className="@container">
      <CardHeader title="Goal progress" icon={<Target />} wrap
        subtitle={PHASE_QUESTION[phase.phase]}
        action={(
          <InfoBubble label="How goal progress works">
            It reads your weight trend, the smart scale&apos;s fat and lean mass, what you logged eating and what Apple says you burned,
            then judges them against the phase you picked — cut, maintain or gain — using published ranges for pace and protein.
            Today is left out because its diary and energy aren&apos;t finished. An estimate from your own data, not medical advice.
          </InfoBubble>
        )} />
      <div className="mb-4"><PhaseBar phase={phase} win={win} onWin={setWin} /></div>
      <ErrorBoundary label="Goal progress">
        <GoalReportBody days={Number(win) as GoalWindow} />
      </ErrorBoundary>
    </Card>
  )
}

function GoalReportBody({ days }: { days: GoalWindow }) {
  const d = useGoalReport(days)
  const [showEnergy, setShowEnergy] = useState(false)
  if (d.isLoading && !d.report) return <SkeletonText lines={6} />
  if (d.isError && !d.report) return <p className="text-body text-fg-muted">Couldn&apos;t load the diary, energy or weight data. Pull to refresh or try again later.</p>
  const r = d.report
  if (!r) return null
  const phase = r.phase
  const e = r.energy
  const verdict = e.verdict ? verdictCopy(e.verdict, phase).title : 'not enough data yet'
  return (
    <div className="flex flex-col gap-3">
      <p className="text-meta tabular-nums text-fg-muted">{fmtDayMonth(d.from)} – {fmtDayMonth(d.to)}</p>
      <GoalPathPanel path={r.path} />
      <div className="grid gap-3 @2xl:grid-cols-2">
        <PaceSection phase={phase} rate={r.rate} meanKg={e.weight.meanKg} />
        <CompositionSection phase={phase} comp={r.comp} extended={r.compFrom < d.from} />
      </div>
      <div>
        <p className="section-label mb-1">Weight trend</p>
        <WeightTrendChart r={e} from={d.from} to={d.to} goalKg={d.goals.settings.goalWeightKg} />
      </div>
      <GoalsSection report={r} settings={d.goals.settings} fromDevice={d.goals.fromDevice} saving={d.goals.isSaving} onSave={d.goals.save} />
      <ProteinBlock r={e} phase={phase} targetProtein={d.phase.targetProtein} />
      <section className="rounded-row border border-line">
        <button type="button" aria-expanded={showEnergy} onClick={() => setShowEnergy(v => !v)}
          className="flex min-h-[44px] w-full items-center gap-2 px-3 py-2.5 text-left">
          <span className="min-w-0 flex-1">
            <span className="block text-body font-medium text-fg">Calories vs the scale</span>
            <span className="block text-meta text-fg-muted">{verdict}</span>
          </span>
          <ChevronDown aria-hidden className={cx('h-4 w-4 shrink-0 text-fg-muted transition-transform', showEnergy && 'rotate-180')} />
        </button>
        {showEnergy && (
          <div className="flex flex-col gap-3 border-t border-line p-3">
            <EnergyVerdict r={e} phase={phase} />
            <EnergyGrid r={e} targetKcal={d.phase.targetKcal} phase={phase} />
          </div>
        )}
      </section>
    </div>
  )
}
