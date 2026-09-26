import { ChevronLeft, ChevronRight } from 'lucide-react'
import { DateInput } from './DateInput'
import { cx } from '../ui/cx'

// ─────────────────────────────────────────────────────────────────────────────
//  THE app-wide standard date navigator: ‹ [label] › — previous on the LEFT of
//  the label, next on the RIGHT, label centered between them. Every date-based
//  view (Daily header, week calendar, meal plan, training calendar, Health
//  sections) uses this one component so stepping through time looks and works
//  identically everywhere.
//
//  Optional extras: `onToday` renders a small "Today" reset (only when not
//  already on today — pass `isToday`), `pickerValue`/`onPick` render a
//  DD/MM/YYYY jump-to-date input, `size` bumps touch targets for page-level
//  headers vs compact widget headers.
// ─────────────────────────────────────────────────────────────────────────────

export function DateNav({
  label, onPrev, onNext, canGoNext = true, canGoPrev = true,
  onToday, isToday, pickerValue, onPick, pickerMax, size = 'sm', labelClassName,
}: {
  label: React.ReactNode
  onPrev: () => void
  onNext: () => void
  canGoNext?: boolean
  canGoPrev?: boolean
  onToday?: () => void
  isToday?: boolean
  pickerValue?: string
  onPick?: (date: string) => void
  pickerMax?: string
  size?: 'sm' | 'md'
  labelClassName?: string
}) {
  // The hit box always reaches 44px; `sm` keeps a narrower 36px width so
  // compact widget headers still fit their row.
  const btn = cx(
    'grid min-h-[44px] place-items-center rounded-control text-fg-muted transition-colors duration-150',
    'hover:bg-surface-hover hover:text-fg disabled:opacity-30 disabled:hover:bg-transparent',
    size === 'md' ? 'min-w-[44px]' : 'min-w-[36px]',
  )
  const icon = size === 'md' ? 'h-[18px] w-[18px]' : 'h-4 w-4'
  const lbl = labelClassName ?? (size === 'md'
    ? 'min-w-[130px] text-ui font-semibold text-fg'
    : 'min-w-[92px] text-meta font-semibold text-fg-2')

  return (
    <div className="flex items-center gap-0.5">
      <button type="button" onClick={onPrev} disabled={!canGoPrev} aria-label="Previous" className={btn}>
        <ChevronLeft className={icon} aria-hidden />
      </button>
      <span className={cx(lbl, 'text-center tabular-nums')}>{label}</span>
      <button type="button" onClick={onNext} disabled={!canGoNext} aria-label="Next" className={btn}>
        <ChevronRight className={icon} aria-hidden />
      </button>
      {onToday && !isToday && (
        <button
          type="button" onClick={onToday}
          className="ml-1 min-h-[44px] rounded-control px-2.5 text-meta font-semibold text-accent-600 transition-colors duration-150 hover:bg-accent-50"
        >Today</button>
      )}
      {/* A 76px box clipped DD/MM/YYYY on phones: the app-wide iOS anti-zoom
          rule forces text inputs to 16px on coarse pointers, which needs ~92px.
          Widen the box — never shrink the font, that re-arms the zoom bug. */}
      {pickerValue !== undefined && onPick && (
        <DateInput
          value={pickerValue}
          max={pickerMax}
          onChange={v => v && onPick(pickerMax && v > pickerMax ? pickerMax : v)}
          aria-label="Jump to date"
          className="min-h-[44px] w-[104px] rounded-input border border-line bg-transparent px-1 text-meta text-fg-muted sm:w-[84px]"
        />
      )}
    </div>
  )
}
