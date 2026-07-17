import { todayStr } from '../../../../shared/utils/dateUtils'
import { DateNav as SharedDateNav } from '../../../../shared/components/DateNav'

// Thin wrapper around the app-wide standard DateNav (shared/components/
// DateNav.tsx) — Health was the original pattern source; the shared component
// is now canonical and this keeps Health's existing call sites unchanged.
export function DateNav({
  label, onPrev, onNext, canGoNext, value, onPick,
}: {
  label: string
  onPrev: () => void
  onNext: () => void
  canGoNext: boolean
  value: string
  onPick: (date: string) => void
}) {
  return (
    <SharedDateNav
      label={label}
      onPrev={onPrev}
      onNext={onNext}
      canGoNext={canGoNext}
      pickerValue={value}
      onPick={onPick}
      pickerMax={todayStr()}
    />
  )
}
