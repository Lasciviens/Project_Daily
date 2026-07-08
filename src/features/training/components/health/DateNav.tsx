import { todayStr } from '../../../../shared/utils/dateUtils'

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
      <input
        type="date"
        value={value}
        max={todayStr()}
        onChange={e => e.target.value && onPick(e.target.value > todayStr() ? todayStr() : e.target.value)}
        aria-label="Jump to date"
        className="min-h-[28px] px-1 text-[11px] text-ink-500 border border-ink-100 rounded-md bg-transparent"
      />
    </div>
  )
}
