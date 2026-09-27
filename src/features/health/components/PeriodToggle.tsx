import { SegmentedControl } from '../../../shared/ui'

export type Period = 'day' | 'week' | 'month'

// Rolling windows ending on the selected day, labelled as such (T42).
const OPTIONS: { value: Period; label: string }[] = [
  { value: 'day',   label: 'Day'     },
  { value: 'week',  label: '7 days'  },
  { value: 'month', label: '30 days' },
]

export function PeriodToggle({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  return <SegmentedControl<Period> size="sm" value={value} onChange={onChange} options={OPTIONS} />
}
