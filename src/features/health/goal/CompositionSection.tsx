import type { ReactNode } from 'react'
import { TonePill } from '../../../shared/ui'
import { fmtDayMonth } from '../components/healthFormat'
import type { CompositionResult, Phase, SeriesTrend } from './bodyGoal'
import { COMPOSITION_LABEL, CONFIDENCE_COPY, compositionTone, signed, sourceLabel } from './goalCopy'
import { GoalBlock, Cites } from './GoalBlock'

function Change({ label, t, unit, dp = 1 }: { label: ReactNode; t: SeriesTrend | null; unit: string; dp?: number }) {
  return (
    <div className="min-w-0">
      <dt className="text-meta text-fg-muted">{label}</dt>
      {t ? (
        <dd className="tabular-nums">
          <span className={t.significant ? 'text-lead font-semibold text-fg' : 'text-lead font-semibold text-fg-muted'}>{signed(t.change, dp, ` ${unit}`)}</span>
          <span className="block text-meta text-fg-muted">
            {t.significant ? `${signed(t.perWeek, 2)} ${unit}/week` : 'within noise'} · now {t.current.toFixed(dp)} {unit}
          </span>
        </dd>
      ) : <dd className="text-body text-fg-muted">—</dd>}
    </div>
  )
}

/** Fat mass vs lean mass (and the reports' muscle mass) from the smart
 *  scale, with how much the readings can support. */
export function CompositionSection({ phase, comp, extended }: { phase: Phase; comp: CompositionResult; extended: boolean }) {
  const conf = comp.confidence ? CONFIDENCE_COPY[comp.confidence] : null
  return (
    <GoalBlock title="Fat and muscle" info={<>
      From the smart scale&apos;s body fat % and lean mass (everything that isn&apos;t fat: mostly muscle and water). Bioimpedance swings with hydration, glycogen and food — even under lab control fat mass moved ±0.5 kg and lean mass ±0.6 kg from day to day (Looney 2024) — so the report fits a line through 4+ readings over 14+ days and only calls a change real when it beats 0.5 kg and twice its own noise. Readings from different scales or apps are never mixed. Early in a cut, part of a lean drop is glycogen water.
      <Cites keys={['looney2024']} />
    </>}>
      <p className="flex flex-wrap items-center gap-2">
        <TonePill tone={compositionTone(comp.verdict, phase)}>{COMPOSITION_LABEL[comp.verdict]}</TonePill>
        {conf && <TonePill tone={conf.tone}>{conf.label}</TonePill>}
      </p>
      {comp.verdict === 'not_enough_data' ? (
        <p className="text-body text-fg-muted">{comp.missing}</p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
            <Change label="Fat mass" t={comp.fat} unit="kg" />
            <Change label="Lean mass" t={comp.lean} unit="kg" />
            {comp.fatPct && <Change label="Body fat" t={comp.fatPct} unit="%" />}
            {comp.muscle && <Change label="Muscle (reports)" t={comp.muscle} unit="kg" />}
          </dl>
          <p className="text-meta text-fg-muted">
            {comp.readings} readings from {sourceLabel(comp.source)}, {comp.fat ? `${fmtDayMonth(comp.fat.firstDate)} → ${fmtDayMonth(comp.fat.lastDate)}` : ''}.
            {comp.leanShare != null && ` ${Math.round(comp.leanShare * 100)} % of the change was lean mass.`}
          </p>
        </>
      )}
      {extended && <p className="text-meta text-fg-muted">Reads the last 28 days — telling fat from muscle needs more readings than the weight trend.</p>}
      {comp.otherSources.length > 0 && (
        <p className="text-meta text-fg-muted">
          Left out: {comp.otherSources.map(sourceLabel).join(', ')} — two scales or apps can read the same body a few % apart.
        </p>
      )}
    </GoalBlock>
  )
}
