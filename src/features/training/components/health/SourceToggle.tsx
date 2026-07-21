// Per-section data-source switch — the CARDINAL RULE's UI: any metric,
// any source, on demand. 'auto' = both streams resolved by the source
// resolver (one winning stream per hour/day/night window); 'apple' /
// 'fitbit' = that family's raw stream only (server-side filter via
// fetchHealthMetricSeries' sourceFamily param). Labelled "Google" because
// that's the user's mental model (data comes from the Google Health API),
// while the stored family value stays 'fitbit'.
export type SourceSelection = 'auto' | 'apple' | 'fitbit'

const OPTIONS: { value: SourceSelection; label: string }[] = [
  { value: 'auto',   label: 'Auto' },
  { value: 'apple',  label: 'Apple' },
  { value: 'fitbit', label: 'Google' },
]

export function SourceToggle({ value, onChange }: {
  value: SourceSelection
  onChange: (v: SourceSelection) => void
}) {
  return (
    <div className="flex gap-0.5 p-0.5 bg-cream-100 rounded-lg w-fit" title="Data source — Auto resolves both devices into one series; Apple/Google show a single source">
      {OPTIONS.map(o => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`min-h-[44px] px-2.5 rounded-md text-[11px] font-semibold transition-colors ${
            value === o.value ? 'bg-cream-50 text-ink-900 shadow-card' : 'text-ink-400 hover:text-ink-700'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
