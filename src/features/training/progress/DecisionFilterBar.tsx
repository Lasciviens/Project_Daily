import { cx } from '../../../shared/ui'
import {
  DATE_WINDOWS, showsRoutineFilter, type DateWindow, type DecisionFilters, type MuscleOption, type RoutineOption,
} from './decisionFilters'
import type { EvidenceLevel } from '../progress-engine/types'

// The decision table's search, sort and filters. Sized by the card's own
// width: below 40rem a 2-column grid with each label above its select, the
// selects in pairs (Muscle | Routine, Evidence | Window); wider, one wrapping
// row of inline label + select pairs. Which exercises a filter keeps is
// decided in decisionFilters.ts — this only renders the controls.

const FILTER_LABEL = 'flex min-w-0 flex-col gap-0.5 text-meta text-fg-muted @[40rem]:flex-row @[40rem]:items-center @[40rem]:gap-1.5'
const FILTER_SELECT = 'select w-full min-w-0 py-0 text-meta @[40rem]:w-auto'

function MuscleChoices({ options }: { options: readonly MuscleOption[] }) {
  const main = options.filter(o => o.major)
  const other = options.filter(o => !o.major)
  const list = (items: readonly MuscleOption[]) => items.map(o => <option key={o.slug} value={o.slug}>{o.label}</option>)
  if (main.length === 0 || other.length === 0) return <>{list(options)}</>
  return (
    <>
      <optgroup label="Main muscles">{list(main)}</optgroup>
      <optgroup label="Other muscles">{list(other)}</optgroup>
    </>
  )
}

interface Props {
  /** The filters that apply (effectiveFilters): a pick no longer offered reads Any. */
  filters: DecisionFilters
  onChange: (patch: Partial<DecisionFilters>) => void
  onClear: () => void
  active: boolean
  sort: string
  sortOptions: readonly { id: string; label: string }[]
  onSortChange: (id: string) => void
  muscles: readonly MuscleOption[]
  routines: readonly RoutineOption[]
  shown: number
  total: number
}

export function DecisionFilterBar({ filters, onChange, onClear, active, sort, sortOptions, onSortChange, muscles, routines, shown, total }: Props) {
  const showMuscle = muscles.length > 0
  const showRoutine = showsRoutineFilter(routines)
  return (
    <div className="mb-3 grid grid-cols-2 items-end gap-2 @[40rem]:flex @[40rem]:flex-wrap @[40rem]:items-center">
      <input
        type="text" value={filters.query} onChange={e => onChange({ query: e.target.value })} placeholder="Search exercise…" aria-label="Search exercise"
        className="input col-span-2 w-full @[40rem]:w-56"
      />
      <label className={cx(FILTER_LABEL, 'col-span-2')}>
        Sort:
        <select value={sort} onChange={e => onSortChange(e.target.value)} className={FILTER_SELECT}>
          {sortOptions.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </label>
      {showMuscle && (
        <label className={cx(FILTER_LABEL, !showRoutine && 'col-span-2')}>
          Muscle:
          <select value={filters.muscle} onChange={e => onChange({ muscle: e.target.value })} className={FILTER_SELECT}>
            <option value="any">Any</option>
            <MuscleChoices options={muscles} />
          </select>
        </label>
      )}
      {showRoutine && (
        <label className={cx(FILTER_LABEL, !showMuscle && 'col-span-2')}>
          Routine:
          <select value={filters.routineId} onChange={e => onChange({ routineId: e.target.value })} className={FILTER_SELECT}>
            <option value="any">Any</option>
            {routines.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        </label>
      )}
      <label className={FILTER_LABEL}>
        Evidence:
        <select value={filters.evidence} onChange={e => onChange({ evidence: e.target.value as 'any' | EvidenceLevel })} className={FILTER_SELECT}>
          <option value="any">Any</option>
          <option value="limited">Limited</option>
          <option value="moderate">Moderate</option>
          <option value="strong">Strong</option>
        </select>
      </label>
      <label className={FILTER_LABEL}>
        Window:
        <select value={filters.window} onChange={e => onChange({ window: e.target.value as DateWindow })} className={FILTER_SELECT}>
          {DATE_WINDOWS.map(w => <option key={w.id} value={w.id}>{w.label}</option>)}
        </select>
      </label>
      {active && (
        <button type="button" onClick={onClear} className="btn-ghost btn-sm col-span-2 justify-self-start text-meta !text-accent-600">
          Clear filters
        </button>
      )}
      <span className="col-span-2 ml-auto text-meta tabular-nums text-fg-muted">{shown} of {total}</span>
    </div>
  )
}
