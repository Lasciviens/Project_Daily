import type { BodyCompositionReport } from '../../api/bodyCompositionApi'
import { BODY_COMP_FIELDS, deltaFor, type BodyCompFieldKey } from '../../bodyCompositionAggregate'

// One card per report field — "all the data" from the latest scan at a
// glance, mirroring MetricMiniCard's small-card anatomy (icon+label / big
// value+unit / a small secondary line) so this reads as the same family of
// component as the rest of Health, not a bespoke one-off.
function StatCard({
  fieldKey, value, delta,
}: {
  fieldKey: BodyCompFieldKey
  value: number
  delta: ReturnType<typeof deltaFor>
}) {
  const meta = BODY_COMP_FIELDS.find(f => f.key === fieldKey)!
  const arrow = !delta || Math.abs(delta.delta) < 0.05 ? '·' : delta.delta > 0 ? '▲' : '▼'
  return (
    <div className="bg-cream-50 border border-ink-100 rounded-xl p-3 flex flex-col gap-1.5">
      <p className="text-[11px] font-bold uppercase tracking-wide text-ink-400 leading-tight" style={{ color: meta.color }}>
        {meta.icon} {meta.label}
      </p>
      <p className="text-lg font-bold text-ink-900 leading-tight">
        {value.toFixed(meta.decimals)}
        <span className="text-[11px] font-normal text-ink-400 ml-1">{meta.unit}</span>
      </p>
      {delta && Math.abs(delta.delta) >= 0.05 ? (
        <p className="text-[11px] font-semibold text-ink-500">
          {arrow} {delta.delta > 0 ? '+' : ''}{delta.delta.toFixed(meta.decimals)} {meta.unit}
          {delta.deltaPercent != null && ` (${delta.deltaPercent > 0 ? '+' : ''}${delta.deltaPercent.toFixed(1)}%)`}
          <span className="text-ink-300 font-normal"> vs last scan</span>
        </p>
      ) : (
        <p className="text-[11px] text-ink-300">{arrow} vs last scan</p>
      )}
    </div>
  )
}

// Deliberately no colour-coded "good/bad" arrow (green-up/red-down or the
// reverse) — whether a rising number is welcome depends on the field AND the
// person's own goal (this table has no concept of one), so every arrow stays
// neutral ink, same reasoning as WeeklyChangesPanel's un-scored change flags.
export function BodyCompStatGrid({
  latest, previous,
}: {
  latest: BodyCompositionReport
  previous: BodyCompositionReport | null
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
      {BODY_COMP_FIELDS.map(f => (
        <StatCard key={f.key} fieldKey={f.key} value={latest[f.key]} delta={deltaFor(latest, previous, f.key)} />
      ))}
    </div>
  )
}
