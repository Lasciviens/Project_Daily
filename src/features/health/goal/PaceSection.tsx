import { TonePill, cx } from '../../../shared/ui'
import { CUT_LIMIT, GAIN_LIMIT, PHASE_TARGET, type Phase, type RateVerdict } from './bodyGoal'
import { RATE_COPY, signed } from './goalCopy'
import { GoalBlock, Cites } from './GoalBlock'

// The gauge's axis (signed %BW/week, + = gaining) and its coloured zones per
// phase. Zones use tone soft fills; the dot is the current pace.
type Zone = { from: number; to: number; cls: string }
const AXIS: Record<Phase, { min: number; max: number; zones: Zone[]; ticks: number[] }> = {
  cut: {
    min: -2, max: 0.5, ticks: [CUT_LIMIT, -1, -0.5, 0],
    zones: [
      { from: -2, to: CUT_LIMIT, cls: 'bg-danger-soft' },
      { from: CUT_LIMIT, to: -1, cls: 'bg-warn-soft' },
      { from: -1, to: -0.5, cls: 'bg-success-soft' },
    ],
  },
  gain: {
    min: -0.5, max: 1.25, ticks: [0, 0.25, 0.5, GAIN_LIMIT],
    zones: [
      { from: 0.25, to: 0.5, cls: 'bg-success-soft' },
      { from: 0.5, to: GAIN_LIMIT, cls: 'bg-warn-soft' },
      { from: GAIN_LIMIT, to: 1.25, cls: 'bg-danger-soft' },
    ],
  },
  maintain: {
    min: -1, max: 1, ticks: [-0.25, 0, 0.25],
    zones: [{ from: -0.25, to: 0.25, cls: 'bg-success-soft' }],
  },
}

const fmtTick = (v: number) => (v === 0 ? '0' : `${v > 0 ? '+' : '−'}${Math.abs(v)}`)

function PaceGauge({ phase, pct }: { phase: Phase; pct: number }) {
  const a = AXIS[phase]
  const at = (v: number) => ((Math.min(a.max, Math.max(a.min, v)) - a.min) / (a.max - a.min)) * 100
  const t = PHASE_TARGET[phase]
  return (
    <div role="img" aria-label={`Pace ${signed(pct, 2)} % a week; the ${phase} range is ${fmtTick(t.lo)} to ${fmtTick(t.hi)} %.`} className="pt-1">
      <div className="relative h-2.5 rounded-full bg-surface-2">
        {a.zones.map(z => (
          <span key={z.from} aria-hidden className={cx('absolute inset-y-0', z.cls)} style={{ left: `${at(z.from)}%`, width: `${at(z.to) - at(z.from)}%` }} />
        ))}
        <span aria-hidden className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-fg shadow-float"
          style={{ left: `${at(pct)}%` }} />
      </div>
      <div aria-hidden className="relative mt-1 h-4 text-micro font-normal tabular-nums text-fg-muted">
        {a.ticks.map(v => (
          <span key={v} className="absolute -translate-x-1/2" style={{ left: `${at(v)}%` }}>{fmtTick(v)}</span>
        ))}
      </div>
      <p className="text-micro font-normal text-fg-muted">% of bodyweight a week · green = the {phase} range</p>
    </div>
  )
}

const RANGE_NOTE: Record<Phase, string> = {
  cut: 'Past 1 % a week muscle is increasingly at risk; beyond 1.4 % it is outside the studied range.',
  maintain: 'That is about as much as the trend moves on its own over a few weeks.',
  gain: 'Past 0.5 % a week most of the extra is fat; advanced lifters do best near 0.25 %.',
}

/** Pace per week vs the phase's range, as kg and % of bodyweight. */
export function PaceSection({ phase, rate, meanKg }: { phase: Phase; rate: RateVerdict | null; meanKg: number | null }) {
  const t = PHASE_TARGET[phase]
  const lo = Math.min(Math.abs(t.lo), Math.abs(t.hi)), hi = Math.max(Math.abs(t.lo), Math.abs(t.hi))
  const range = phase === 'maintain'
    ? 'Steady: within ±0.25 % a week.'
    : `${phase === 'cut' ? 'Cut' : 'Gain'} range: ${lo}–${hi} % a week${meanKg ? ` (${(lo * meanKg / 100).toFixed(2)}–${(hi * meanKg / 100).toFixed(2)} kg at your weight)` : ''}.`
  return (
    <GoalBlock title="Pace" info={<>
      The slope of a straight line through every weigh-in in the window, as a share of your weight. Cut: lose ~0.5–1 % a week to keep muscle (Helms 2014); at ~0.7 %/wk athletes gained lean mass while cutting, at ~1.4 %/wk it only held (Garthe 2011). Gain: ~0.25–0.5 % a week with a 10–20 % surplus (Iraki 2019). Maintain: ±0.25 % is a heuristic, not a published cut-off. The kcal advice uses 7,700 kcal per kg (Hall 2008) — read it as ±15 %.
      <Cites keys={['helms2014prep', 'garthe2011', 'iraki2019', 'hall2008']} />
    </>}>
      {!rate ? <p className="text-body text-fg-muted">Needs 4+ weigh-ins over a week.</p> : (
        <>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <strong className="text-lead tabular-nums text-fg">{signed(rate.kgPerWeek, 2, ' kg')}/week</strong>
            <span className="text-meta tabular-nums text-fg-muted">({signed(rate.pctPerWeek, 2, ' %')} of bodyweight)</span>
            <TonePill tone={RATE_COPY[rate.status].tone}>{RATE_COPY[rate.status].label}</TonePill>
          </p>
          <PaceGauge phase={phase} pct={rate.pctPerWeek} />
        </>
      )}
      <p className="text-meta text-fg-muted">{range} {RANGE_NOTE[phase]}</p>
    </GoalBlock>
  )
}
