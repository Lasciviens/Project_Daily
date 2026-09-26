import { SegmentedControl } from '../../../../shared/ui'

export type Period = 'day' | 'week' | 'month'

const OPTIONS: { value: Period; label: string }[] = [
  { value: 'day',   label: 'Day'   },
  { value: 'week',  label: 'Week'  },
  { value: 'month', label: 'Month' },
]

export function PeriodToggle({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  return <SegmentedControl<Period> size="sm" value={value} onChange={onChange} options={OPTIONS} />
}
