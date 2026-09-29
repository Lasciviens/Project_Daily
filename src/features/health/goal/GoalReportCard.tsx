import { useState } from 'react'
import { ChevronDown, Target } from 'lucide-react'
import { Card, CardHeader, PageBoard, SkeletonText, cx, useBoardStep } from '../../../shared/ui'
import { keysAt } from '../../../shared/ui/pageBoardRules'
import { GOAL_BOARD } from '../healthBoards'
import { InfoBubble } from '../../../shared/components/InfoBubble'
import { ErrorBoundary } from '../../../shared/components/ErrorBoundary'
import { todayStr } from '../../../shared/utils/dateUtils'
import { numericSpanLabel } from '../healthDateLabels'
import { goalWindowDates, useGoalReport, type GoalWindow } from './useGoalReport'
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

type GoalData = ReturnType<typeof useGoalReport>

/** "Am I doing this right?" for the phase the person picked (cut, maintain,
 *  gain): pace vs the science-based range, fat vs muscle from the scale,
 *  progress toward their body goals, and calories vs the scale. Reads its
 *  own data; no props. On a phone it is one card; on a wider page the goals,
 *  protein and calories-vs-scale blocks become cards of their own beside the
 *  report (healthBoards.ts → GOAL_BOARD). */
export function GoalReportCard() {
  const [win, setWin] = useState<`${GoalWindow}`>('28')
  const days = Number(win) as GoalWindow
  const d = useGoalReport(days)
  return (
    <PageBoard layout={GOAL_BOARD} sections={{
      report: <GoalReportMain win={win} onWin={setWin} d={d} />,
      goals: <GoalPart d={d} part="goals" />,
      protein: <GoalPart d={d} part="protein" />,
      energy: <GoalPart d={d} part="energy" />,
    }} />
  )
}

function GoalReportMain({ win, onWin, d }: { win: `${GoalWindow}`; onWin: (w: `${GoalWindow}`) => void; d: GoalData }) {
  const phase = usePhase()
  const today = todayStr()
  const { from, to } = goalWindowDates(Number(win) as GoalWindow, today)
  // The side blocks sit inside this card unless the board gives them cards of their own.
  const split = keysAt(GOAL_BOARD, useBoardStep()).includes('goals')
  return (
    <Card className="@container">
      <CardHeader title="Goal progress" icon={<Target />} wrap
        subtitle={phase.isLoaded ? PHASE_QUESTION[phase.phase] : 'Is your body moving the right way for your goal?'}
        action={(
          <InfoBubble label="How goal progress works">
            It reads your weight trend, the smart scale&apos;s fat and lean mass, what you logged eating and what Apple says you burned,
            then judges them against the phase you picked — cut, maintain or gain — using published ranges for pace and protein.
            Today is left out because its diary and energy aren&apos;t finished. An estimate from your own data, not medical advice.
          </InfoBubble>
        )} />
      <div className="mb-4"><PhaseBar win={win} onWin={onWin} windowLabel={numericSpanLabel(from, to, today)} /></div>
      <ErrorBoundary label="Goal progress">
        <GoalReportBody d={d} withBlocks={!split} />
      </ErrorBoundary>
    </Card>
  )
}

function GoalReportBody({ d, withBlocks }: { d: GoalData; withBlocks: boolean }) {
  if (d.isLoading && !d.report) return <SkeletonText lines={6} />
  if (d.isError && !d.report) return <p className="text-body text-fg-muted">Couldn&apos;t load the diary, energy or weight data. Pull to refresh or try again later.</p>
  const r = d.report
  if (!r) return null
  const phase = r.phase
  const e = r.energy
  return (
    <div className="flex flex-col gap-3">
      <GoalPathPanel path={r.path} />
      <div className="grid gap-3 @2xl:grid-cols-2">
        <PaceSection phase={phase} rate={r.rate} meanKg={e.weight.meanKg} />
        <CompositionSection phase={phase} comp={r.comp} extended={r.compFrom < d.from} />
      </div>
      <div>
        <p className="section-label mb-1">Weight trend</p>
        <WeightTrendChart r={e} from={d.from} to={d.to} goalKg={d.goals.settings.goalWeightKg} />
      </div>
      {withBlocks && (
        <>
          <GoalsSection report={r} settings={d.goals.settings} fromDevice={d.goals.fromDevice} />
          <ProteinBlock r={e} phase={phase} targetProtein={d.phase.targetProtein} />
          <EnergyDisclosure d={d} />
        </>
      )}
    </div>
  )
}

/** One of the report's side blocks as a card of its own (nothing until the report has loaded). */
function GoalPart({ d, part }: { d: GoalData; part: 'goals' | 'protein' | 'energy' }) {
  const r = d.report
  if (!r) return null
  return (
    <ErrorBoundary label="Goal progress">
      {part === 'goals' && <GoalsSection report={r} settings={d.goals.settings} fromDevice={d.goals.fromDevice} card />}
      {part === 'protein' && <ProteinBlock r={r.energy} phase={r.phase} targetProtein={d.phase.targetProtein} card />}
      {part === 'energy' && <EnergyDisclosure d={d} card />}
    </ErrorBoundary>
  )
}

function EnergyDisclosure({ d, card = false }: { d: GoalData; card?: boolean }) {
  const [showEnergy, setShowEnergy] = useState(false)
  const r = d.report
  if (!r) return null
  const phase = r.phase
  const e = r.energy
  const verdict = e.verdict ? verdictCopy(e.verdict, phase).title : 'not enough data yet'
  return (
    <section className={card ? 'card overflow-hidden' : 'rounded-row border border-line'}>
      <button type="button" aria-expanded={showEnergy} onClick={() => setShowEnergy(v => !v)}
        className={cx('flex min-h-[44px] w-full items-center gap-2 text-left', card ? 'px-4 py-3 sm:px-5' : 'px-3 py-2.5')}>
        <span className="min-w-0 flex-1">
          <span className="block text-body font-medium text-fg">Calories vs the scale</span>
          <span className="block text-meta text-fg-muted">{verdict}</span>
        </span>
        <ChevronDown aria-hidden className={cx('h-4 w-4 shrink-0 text-fg-muted transition-transform', showEnergy && 'rotate-180')} />
      </button>
      {showEnergy && (
        <div className={cx('@container flex flex-col gap-3 border-t border-line', card ? 'p-4 sm:p-5' : 'p-3')}>
          <EnergyVerdict r={e} phase={phase} from={d.from} to={d.to} />
          <EnergyGrid r={e} targetKcal={d.phase.targetKcal} phase={phase} />
        </div>
      )}
    </section>
  )
}
