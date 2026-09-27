import { SegmentedControl } from '../../../shared/ui'

import type { Period } from './period'

export type { Period } from './period'

// Rolling windows ending on the selected day, labelled as such (T42). The
// one-day option reads "Today" while the selected day is today.
export function PeriodToggle({ value, onChange, dayLabel = 'Day' }: { value: Period; onChange: (p: Period) => void; dayLabel?: string }) {
  return (
    <SegmentedControl<Period>
      size="sm"
      value={value}
      onChange={onChange}
      options={[
        { value: 'day',     label: dayLabel  },
        { value: 'week',    label: '7 days'  },
        { value: 'month',   label: '30 days' },
        { value: 'quarter', label: '90 days' },
        { value: 'year',    label: '1 year'  },
      ]}
    />
  )
}
