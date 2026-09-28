import type { HevySet } from '../../types.hevy'
import { SET_TYPE_META } from '../../setTypeMeta'
import { anyRpe, formatRpe, formatSet } from '../../setFormat'

function SetTypeBadge({ type }: { type: HevySet['type'] }) {
  const cfg = SET_TYPE_META[type] ?? SET_TYPE_META.normal
  return (
    <span data-tone={cfg.tone} title={cfg.label} aria-label={cfg.label}
      className="tone-soft tone-text inline-flex h-5 w-5 items-center justify-center rounded text-micro font-bold">
      {cfg.short}
    </span>
  )
}

/** One exercise's logged sets. The RPE column appears only where a set of
 *  this exercise was rated in Hevy (never a column of dashes). */
export function SetTable({ sets, exerciseType }: { sets: readonly HevySet[]; exerciseType?: string | null }) {
  const rated = anyRpe(sets)
  return (
    <table className="w-full text-meta">
      <thead>
        <tr className="section-label">
          <th className="w-7 py-1 text-left font-semibold">#</th>
          <th className="w-9 py-1 text-left font-semibold">Type</th>
          <th className="py-1 text-left font-semibold">Set</th>
          {rated && <th className="w-12 py-1 text-right font-semibold">RPE</th>}
        </tr>
      </thead>
      <tbody>
        {[...sets].sort((a, b) => a.index - b.index).map(set => (
          <tr key={set.id} className="border-t border-line tabular-nums">
            <td className="py-1.5 text-fg-muted">{set.index + 1}</td>
            <td className="py-1.5"><SetTypeBadge type={set.type} /></td>
            {/* Per exercise type: kg × reps, seconds, metres, assistance. */}
            <td className="py-1.5 font-medium text-fg-2">{formatSet(set, exerciseType)}</td>
            {rated && <td className="py-1.5 text-right text-fg-2">{set.rpe != null && set.rpe > 0 ? formatRpe(set.rpe) : '—'}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
