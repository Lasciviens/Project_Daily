import type { ReactNode } from 'react'
import { InfoBubble } from '../../../shared/components/InfoBubble'
import { cx } from '../../../shared/ui'
import type { CutReport } from './energyBalance'
import { kcal, signed } from './cutCopy'

function Fact({ label, value, unit, hint, info, strong }: {
  label: ReactNode; value: ReactNode; unit?: string; hint?: ReactNode; info?: ReactNode; strong?: boolean
}) {
  return (
    <div className={cx('min-w-0 rounded-row border border-line p-3', strong ? 'bg-surface-2' : 'bg-surface')}>
      <dt className="flex items-center gap-1 text-meta text-fg-muted">{label}{info && <InfoBubble>{info}</InfoBubble>}</dt>
      <dd className="mt-0.5 text-lead font-semibold tabular-nums text-fg">
        {value}{unit && <span className="text-meta font-normal text-fg-muted"> {unit}</span>}
      </dd>
      {hint != null && <p className="text-meta text-fg-muted">{hint}</p>}
    </div>
  )
}

/** The raw numbers behind the verdict, each with its own coverage. */
export function CutEnergyGrid({ r, targetKcal }: { r: CutReport; targetKcal: number }) {
  const pct = Math.round(r.intake.completeness * 100)
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      <Fact label="Eaten" value={kcal(r.intake.meanKcal)} unit="kcal/day"
        hint={<>{r.intake.loggedDays} of {r.days} days logged ({pct} %){r.intake.partialDays ? ` · ${r.intake.partialDays} half-logged left out` : ''}</>}
        info={<>The average of the days you logged. A day with nothing logged is a gap, not a 0 kcal day; a day under 800 kcal is treated as half-logged and left out. Target: {kcal(targetKcal)} kcal.</>} />
      <Fact label="Apple burn" value={kcal(r.apple.meanTdee)} unit="kcal/day"
        hint={<>active {kcal(r.apple.meanActive)} + resting {kcal(r.apple.meanBasal)} · {r.apple.days} days</>}
        info="Apple Health active + resting (basal) energy. Days under 1,550 kcal are watch-off gaps and are left out." />
      <Fact label="Logged deficit" value={r.loggedDeficit != null ? signed(r.loggedDeficit) : '—'} unit="kcal/day"
        hint={r.plannedDeficit != null ? <>Planned from your target: {signed(r.plannedDeficit)}</> : undefined} />
      <Fact label="Expected change" value={r.expectedChangeKg != null ? signed(r.expectedChangeKg, 2) : '—'} unit="kg"
        hint={`from the logged deficit over ${r.days} days`}
        info={<>Deficit × days ÷ 7,700 kcal per kg. 7,700 kcal/kg is the classic figure (Hall, Int J Obes 2008). Pure fat holds ~9,400 kcal/kg and lean tissue much less, so the real figure varies; in the first weeks of a cut more of the loss is glycogen and water, which weighs more per kcal (Thomas et al., Metabolism 2013). Read it as ±15 %.</>} />
      <Fact label="Actual trend change" value={r.weight.changeKg != null ? signed(r.weight.changeKg, 2) : '—'} unit="kg" strong
        hint={r.weight.weighIns ? `least-squares line through ${r.weight.weighIns} weigh-ins` : 'no weigh-ins'}
        info="A straight line fitted through every weigh-in in the window, so one heavy or light morning can't swing it." />
      <Fact label="Observed burn" value={kcal(r.observedTdee)} unit="kcal/day" strong
        hint={r.tdeeGap != null ? <>{signed(r.tdeeGap)} vs Apple</> : 'needs food and weigh-ins'}
        info="What you actually burned according to the scale: average intake plus the energy the weight change stands for (trend kg/day × 7,700). If the diary is complete, this is your real maintenance intake." />
    </dl>
  )
}
