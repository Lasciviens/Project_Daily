import { useState } from 'react'
import { Scale } from 'lucide-react'
import { Card, CardHeader, SegmentedControl, SkeletonText } from '../../../shared/ui'
import { InfoBubble } from '../../../shared/components/InfoBubble'
import { ErrorBoundary } from '../../../shared/components/ErrorBoundary'
import { fmtDayMonth } from '../components/healthFormat'
import { useCutReport, type CutWindow } from './useCutReport'
import { CutVerdict } from './CutVerdict'
import { CutEnergyGrid } from './CutEnergyGrid'
import { CutWeightChart } from './CutWeightChart'
import { CutBodyFacts } from './CutBodyFacts'
import { CutSettingsForm } from './CutSettingsForm'

const WINDOWS: { value: `${CutWindow}`; label: string }[] = [
  { value: '14', label: '14 days' },
  { value: '28', label: '28 days' },
  { value: '56', label: '56 days' },
]

/** "How am I doing on my cut?" — food diary vs Apple energy vs the weight
 *  trend over a selectable window. Reads its own data; no props. */
export function CutReportCard() {
  const [win, setWin] = useState<`${CutWindow}`>('28')
  return (
    <Card>
      <CardHeader title="Cut report" icon={<Scale />}
        subtitle="Does the scale match your calorie deficit?"
        action={(
          <InfoBubble label="How the cut report works">
            It compares three measurements: what you logged eating, what Apple says you burned (active + resting), and your
            weight trend. If all three were exact, the deficit would predict the weight change. Working backwards from the scale
            gives your observed burn. Today is left out because its diary and energy aren&apos;t finished. This is an estimate
            from your own data, not medical advice.
          </InfoBubble>
        )} />
      <div className="mb-4">
        <SegmentedControl options={WINDOWS} value={win} onChange={setWin} size="sm" />
      </div>
      <ErrorBoundary label="Cut report">
        <CutReportBody days={Number(win) as CutWindow} />
      </ErrorBoundary>
    </Card>
  )
}

function CutReportBody({ days }: { days: CutWindow }) {
  const d = useCutReport(days)
  if (d.isLoading && !d.report) return <SkeletonText lines={5} />
  if (d.isError && !d.report) return <p className="text-body text-fg-muted">Couldn&apos;t load the diary, energy or weight data. Pull to refresh or try again later.</p>
  const r = d.report
  if (!r) return null
  return (
    <div className="flex flex-col gap-4">
      <p className="text-meta text-fg-muted">
        {fmtDayMonth(d.from)} – {fmtDayMonth(d.to)}
        {d.goal !== 'cut' && ` · your nutrition goal is set to ${d.goal}, the comparison still works`}
      </p>
      <CutVerdict r={r} />
      <CutEnergyGrid r={r} targetKcal={d.targetKcal} />
      <div>
        <p className="section-label mb-1">Weight trend</p>
        <CutWeightChart r={r} from={d.from} to={d.to} goalKg={d.settings.goalWeightKg} />
      </div>
      <CutBodyFacts r={r} targetProtein={d.targetProtein} />
      <details className="rounded-row border border-line p-3">
        <summary className="min-h-[44px] cursor-pointer py-2.5 text-body font-medium text-fg">Goal weight &amp; cut start</summary>
        <div className="mt-3"><CutSettingsForm settings={d.settings} onChange={d.setSettings} /></div>
      </details>
    </div>
  )
}
