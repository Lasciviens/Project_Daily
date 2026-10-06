import { todayStr } from '../../../shared/utils/dateUtils'
import { DateNav as SharedDateNav } from '../../../shared/components/DateNav'

// Thin wrapper around the app-wide standard DateNav (shared/components/
// DateNav.tsx) — Health was the original pattern source; the shared component
// is now canonical and this keeps Health's existing call sites unchanged.
// The label box has a FIXED width (narrower below 380px) for the longest numeric label
// ("30.12.2025 – 05.01.2026", healthDateLabels NUMERIC_SPAN_MAX_CHARS), so the
// arrows and the date box never move when the period or the date changes.
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
      // 8.5rem on the narrowest phones (360px) so the row fits beside the
      // date box; a rare year-crossing label then takes two lines in the
      // same fixed box instead of pushing the row past the screen edge.
      labelClassName="w-[8.5rem] min-[380px]:w-[10rem] shrink-0 text-meta font-semibold leading-tight text-fg-2"
    />
  )
}
