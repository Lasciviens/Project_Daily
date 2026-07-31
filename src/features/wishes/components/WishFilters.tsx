import { SegmentedControl } from '../../../shared/components/SegmentedControl'

export type KindFilter   = 'all' | 'thing' | 'place'
export type StatusFilter = 'active' | 'done' | 'dropped' | 'all'

// Filters only narrow what is DISPLAYED — they never touch the stored rows, and
// "Everything" always brings the whole list back.
export function WishFilters({ kind, status, onKind, onStatus }: {
  kind:     KindFilter
  status:   StatusFilter
  onKind:   (v: KindFilter) => void
  onStatus: (v: StatusFilter) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <SegmentedControl<KindFilter>
        value={kind}
        onChange={onKind}
        size="sm"
        options={[
          { value: 'all', label: 'All' }, { value: 'thing', label: 'Things' }, { value: 'place', label: '📍 Places' },
        ]}
      />
      <SegmentedControl<StatusFilter>
        value={status}
        onChange={onStatus}
        size="sm"
        options={[
          { value: 'active', label: 'Active' }, { value: 'done', label: 'Done' },
          { value: 'dropped', label: 'Dropped' }, { value: 'all', label: 'Everything' },
        ]}
      />
    </div>
  )
}
