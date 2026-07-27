import { DateInput } from './DateInput'

// ─────────────────────────────────────────────────────────────────────────────
//  THE app-wide standard date navigator: ‹ [label] › — previous on the LEFT of
//  the label, next on the RIGHT, label centered between them. Every date-based
//  view (Daily header, week calendar, meal plan, training calendar, Health
//  sections) uses this one component so stepping through time looks and works
//  identically everywhere. Health's original DateNav was the pattern source;
//  it now re-exports this.
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
  // Hit box grows to the 44px minimum; the GLYPH scale (text-base / text-sm)
  // is untouched, so nothing looks bigger — only the tappable area is. `sm`
  // keeps a narrower 36px width so compact widget headers still fit their row.
  const btn = size === 'md'
    ? 'min-h-[44px] min-w-[44px] text-base'
    : 'min-h-[44px] min-w-[36px] text-sm'
  const lbl = labelClassName ?? (size === 'md'
    ? 'text-sm font-semibold text-ink-800 min-w-[130px]'
    : 'text-xs font-semibold text-ink-700 min-w-[92px]')

  return (
    <div className="flex items-center gap-1">
      <button
        type="button" onClick={onPrev} disabled={!canGoPrev} aria-label="Previous"
        className={`${btn} flex items-center justify-center rounded-md text-ink-500 hover:text-ink-800 hover:bg-cream-100 disabled:opacity-30 disabled:hover:bg-transparent`}
      >‹</button>
      <span className={`${lbl} text-center`}>{label}</span>
      <button
        type="button" onClick={onNext} disabled={!canGoNext} aria-label="Next"
        className={`${btn} flex items-center justify-center rounded-md text-ink-500 hover:text-ink-800 hover:bg-cream-100 disabled:opacity-30 disabled:hover:bg-transparent`}
      >›</button>
      {onToday && !isToday && (
        <button
          type="button" onClick={onToday}
          className={`${btn} px-2 w-auto text-[11px] font-medium text-accent-600 hover:text-accent-800 rounded-md hover:bg-accent-50`}
        >Today</button>
      )}
      {/* 76px clipped DD/MM/YYYY to "26/07/202" on a phone: DateInput is a text
          input, and the app-wide iOS anti-zoom rule forces every text-entry
          control to 16px on a coarse pointer, which needs ~92px. Widen the box
          — never shrink the font, that re-arms the zoom bug. */}
      {pickerValue !== undefined && onPick && (
        <DateInput
          value={pickerValue}
          max={pickerMax}
          onChange={v => v && onPick(pickerMax && v > pickerMax ? pickerMax : v)}
          aria-label="Jump to date"
          className="min-h-[44px] w-[104px] sm:w-[76px] px-1 text-[11px] text-ink-500 border border-ink-100 rounded-md bg-transparent"
        />
      )}
    </div>
  )
}
