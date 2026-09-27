import type { ReactNode } from 'react'
import { InfoBubble } from '../../../shared/components/InfoBubble'
import { cx } from '../../../shared/ui'
import type { EnergyReport, Phase } from './energyBalance'
import { kcal, signed } from './goalCopy'

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
export function EnergyGrid({ r, targetKcal, phase }: { r: EnergyReport; targetKcal: number; phase: Phase }) {
  const pct = Math.round(r.intake.completeness * 100)
  // Shown the way the phase thinks about it: a deficit on a cut, a surplus on a gain.
  const balanceLabel = phase === 'cut' ? 'Logged deficit' : phase === 'gain' ? 'Logged surplus' : 'Logged balance'
  const toShown = (deficit: number | null) => (deficit == null ? null : phase === 'cut' ? deficit : -deficit)
  const balance = toShown(r.loggedDeficit), planned = toShown(r.plannedDeficit)
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      <Fact label="Eaten" value={kcal(r.intake.meanKcal)} unit="kcal/day"
        hint={<>{r.intake.loggedDays} of {r.days} days logged ({pct} %){r.intake.partialDays ? ` · ${r.intake.partialDays} half-logged left out` : ''}</>}
        info={<>The average of the days you logged. A day with nothing logged is a gap, not a 0 kcal day; a day under 800 kcal is treated as half-logged and left out. Target: {kcal(targetKcal)} kcal.</>} />
      <Fact label="Apple burn" value={kcal(r.apple.meanTdee)} unit="kcal/day"
        hint={<>active {kcal(r.apple.meanActive)} + resting {kcal(r.apple.meanBasal)} · {r.apple.days} days</>}
        info="Apple Health active + resting (basal) energy. Days under 1,550 kcal are watch-off gaps and are left out." />
      <Fact label={balanceLabel} value={balance != null ? signed(balance) : '—'} unit="kcal/day"
        hint={planned != null ? <>Planned from your target: {signed(planned)}</> : undefined}
        info={phase === 'maintain' ? 'Logged intake − Apple burn: negative is a deficit, positive a surplus.' : undefined} />
      <Fact label="Expected change" value={r.expectedChangeKg != null ? signed(r.expectedChangeKg, 2) : '—'} unit="kg"
        hint={`from the logged deficit over ${r.days} days`}
        info={<>Deficit (or surplus) × days ÷ 7,700 kcal per kg. 7,700 kcal/kg is the classic figure (Hall, Int J Obes 2008). Pure fat holds ~9,400 kcal/kg and lean tissue much less, so the real figure varies; in the first weeks of a cut or gain more of the change is glycogen and water, which weighs more per kcal (Thomas et al., Metabolism 2013). Read it as ±15 %.</>} />
      <Fact label="Actual trend change" value={r.weight.changeKg != null ? signed(r.weight.changeKg, 2) : '—'} unit="kg" strong
        hint={r.weight.weighIns ? `least-squares line through ${r.weight.weighIns} weigh-ins` : 'no weigh-ins'}
        info="A straight line fitted through every weigh-in in the window, so one heavy or light morning can't swing it." />
      <Fact label="Observed burn" value={kcal(r.observedTdee)} unit="kcal/day" strong
        hint={r.tdeeGap != null ? <>{signed(r.tdeeGap)} vs Apple</> : 'needs food and weigh-ins'}
        info="What you actually burned according to the scale: average intake plus the energy in the weight you lost, or minus the energy in the weight you gained (trend kg/day × 7,700). If the diary is complete, this is your real maintenance intake." />
    </dl>
  )
}
