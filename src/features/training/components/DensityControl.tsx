import type { Density } from '../density'

// ─────────────────────────────────────────────────────────────────────────────
//  DENSITY PILOT — the user-adjustable density strategy (Gmail compact/cozy,
//  Cloudscape comfortable/compact): a 3-step token switch that swaps a handful
//  of CSS custom properties on a `.density-scope` wrapper (see index.css), so
//  everything inside tightens with zero per-component logic. Piloted on the
//  Workouts list and reused by Body ("all strategies" demo). If approved as a
//  global standard it graduates to SettingsMenu next to the theme toggle.
//  State/class mapping live in ../density.ts (component-only file rule).
// ─────────────────────────────────────────────────────────────────────────────

const OPTIONS: { value: Density; label: string }[] = [
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'compact',     label: 'Compact' },
  { value: 'dense',       label: 'Dense' },
]

export function DensityControl({ value, onChange }: { value: Density; onChange: (d: Density) => void }) {
  return (
    <div className="flex gap-0.5 p-0.5 bg-cream-100 rounded-lg" title="Display density — how much data fits per screen">
      {OPTIONS.map(o => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`px-2 min-h-[28px] rounded-md text-[11px] font-semibold transition-colors ${
            value === o.value ? 'bg-cream-50 text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-800'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
