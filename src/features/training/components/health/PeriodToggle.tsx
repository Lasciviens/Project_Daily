export type Period = 'day' | 'week' | 'month'

const OPTIONS: { value: Period; label: string }[] = [
  { value: 'day',   label: 'Day'   },
  { value: 'week',  label: 'Week'  },
  { value: 'month', label: 'Month' },
]

export function PeriodToggle({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  return (
    <div className="flex gap-0.5 p-0.5 bg-cream-100 rounded-lg">
      {OPTIONS.map(o => (
        // 44px hit box, unchanged 11px glyph scale — this sits right next to
        // the already-compliant SourceToggle, where the mismatch was visible.
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`px-2.5 min-h-[44px] rounded-md text-[11px] font-semibold transition-colors ${
            value === o.value ? 'bg-cream-50 text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-800'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
