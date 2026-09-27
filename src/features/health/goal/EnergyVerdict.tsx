import { TonePill } from '../../../shared/ui'
import type { EnergyReport, Phase } from './energyBalance'
import { CONFIDENCE_COPY, kcal, reasonCopy, signed, verdictCopy } from './goalCopy'

/** Does the scale agree with diary − Apple? With the numbers behind it, the
 *  likely reason and how much the window can support. */
export function EnergyVerdict({ r, phase }: { r: EnergyReport; phase: Phase }) {
  if (!r.verdict) {
    return (
      <div className="rounded-row border border-line bg-surface-2 p-3">
        <p className="text-body font-semibold text-fg">Not enough data to compare calories with the scale yet</p>
        <ul className="mt-1 list-disc pl-5 text-meta text-fg-muted">
          {r.missing.map(m => <li key={m}>{m}</li>)}
        </ul>
        <p className="mt-1 text-meta text-fg-muted">The numbers below still show what there is.</p>
      </div>
    )
  }
  const v = verdictCopy(r.verdict, phase)
  const c = r.confidence ? CONFIDENCE_COPY[r.confidence] : null
  const perWeekGap = r.tdeeGap != null ? Math.abs(r.tdeeGap) * 7 / 7700 : null
  const deficit = r.loggedDeficit ?? 0
  return (
    <div className="rounded-row border border-line bg-surface-2 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <TonePill tone={v.tone}>{v.title}</TonePill>
        {c && <TonePill tone={c.tone}>{c.label}</TonePill>}
      </div>
      <p className="mt-2 text-body text-fg-2">
        Your diary and Apple say a {deficit >= 0 ? 'deficit' : 'surplus'} of <strong className="tabular-nums text-fg">{kcal(Math.abs(deficit))} kcal/day</strong>,
        which predicts <strong className="tabular-nums text-fg">{r.expectedChangeKg != null ? signed(r.expectedChangeKg, 1, ' kg') : '—'}</strong> over {r.days} days.
        Your weight trend moved <strong className="tabular-nums text-fg">{r.weight.changeKg != null ? signed(r.weight.changeKg, 1, ' kg') : '—'}</strong>.
        {r.verdict !== 'on_track' && r.tdeeGap != null && perWeekGap != null && (
          <> That is a gap of about <strong className="tabular-nums text-fg">{kcal(Math.abs(r.tdeeGap))} kcal/day</strong> (≈{perWeekGap.toFixed(2)} kg a week).</>
        )}
      </p>
      {r.reasons.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1 text-meta text-fg-2">
          {r.reasons.slice(0, 3).map(k => <li key={k}>• {reasonCopy(k, phase)}</li>)}
        </ul>
      )}
      {r.confidenceNotes.length > 0 && (
        <p className="mt-2 text-meta text-fg-muted">{r.confidenceNotes.join(' ')}</p>
      )}
    </div>
  )
}
