import { todayStr } from '../../../../shared/utils/dateUtils'
import { DateInput } from '../../../../shared/components/DateInput'

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
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={onPrev}
        className="min-h-[28px] min-w-[28px] flex items-center justify-center rounded-md text-ink-400 hover:text-ink-800 hover:bg-cream-100"
      >
        ‹
      </button>
      <span className="text-xs font-semibold text-ink-700 min-w-[92px] text-center">{label}</span>
      <button
        type="button"
        onClick={onNext}
        disabled={!canGoNext}
        className="min-h-[28px] min-w-[28px] flex items-center justify-center rounded-md text-ink-400 hover:text-ink-800 hover:bg-cream-100 disabled:opacity-30 disabled:hover:bg-transparent"
      >
        ›
      </button>
      {/* DateInput (not a raw <input type="date">) — a native date input's
          visible text follows the browser/OS locale, which silently showed
          MM/DD/YYYY instead of the mandated DD/MM/YYYY for anyone not on an
          en-GB locale. */}
      <DateInput
        value={value}
        max={todayStr()}
        onChange={v => v && onPick(v > todayStr() ? todayStr() : v)}
        aria-label="Jump to date"
        className="min-h-[28px] w-[76px] px-1 text-[11px] text-ink-500 border border-ink-100 rounded-md bg-transparent"
      />
    </div>
  )
}
