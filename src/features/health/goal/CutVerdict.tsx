import { TonePill } from '../../../shared/ui'
import type { CutReport } from './energyBalance'
import { CONFIDENCE_COPY, REASON_COPY, VERDICT_COPY, kcal, signed } from './cutCopy'

/** The headline: does the scale agree with diary − Apple? With the numbers
 *  behind it, the likely reason and how much the window can support. */
export function CutVerdict({ r }: { r: CutReport }) {
  if (!r.verdict) {
    return (
      <div className="rounded-row border border-line bg-surface-2 p-3">
        <p className="text-body font-semibold text-fg">Not enough data for a verdict yet</p>
        <ul className="mt-1 list-disc pl-5 text-meta text-fg-muted">
          {r.missing.map(m => <li key={m}>{m}</li>)}
        </ul>
        <p className="mt-1 text-meta text-fg-muted">The numbers below still show what there is.</p>
      </div>
    )
  }
  const v = VERDICT_COPY[r.verdict]
  const c = r.confidence ? CONFIDENCE_COPY[r.confidence] : null
  const perWeekGap = r.tdeeGap != null ? Math.abs(r.tdeeGap) * 7 / 7700 : null
  return (
    <div className="rounded-row border border-line bg-surface-2 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <TonePill tone={v.tone}>{v.title}</TonePill>
        {c && <TonePill tone={c.tone}>{c.label}</TonePill>}
      </div>
      <p className="mt-2 text-body text-fg-2">
        Your diary and Apple say a deficit of <strong className="tabular-nums text-fg">{kcal(r.loggedDeficit)} kcal/day</strong>,
        which predicts <strong className="tabular-nums text-fg">{r.expectedChangeKg != null ? signed(r.expectedChangeKg, 1, ' kg') : '—'}</strong> over {r.days} days.
        Your weight trend moved <strong className="tabular-nums text-fg">{r.weight.changeKg != null ? signed(r.weight.changeKg, 1, ' kg') : '—'}</strong>.
        {r.verdict !== 'on_track' && r.tdeeGap != null && perWeekGap != null && (
          <> That is a gap of about <strong className="tabular-nums text-fg">{kcal(Math.abs(r.tdeeGap))} kcal/day</strong> (≈{perWeekGap.toFixed(2)} kg a week).</>
        )}
      </p>
      {r.reasons.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1 text-meta text-fg-2">
          {r.reasons.slice(0, 3).map(k => <li key={k}>• {REASON_COPY[k]}</li>)}
        </ul>
      )}
      {r.confidenceNotes.length > 0 && (
        <p className="mt-2 text-meta text-fg-muted">{r.confidenceNotes.join(' ')}</p>
      )}
    </div>
  )
}
