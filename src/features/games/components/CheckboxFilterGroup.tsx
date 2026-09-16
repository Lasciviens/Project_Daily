import { useId } from 'react'

// A filter that opens IN PLACE, across the row under the toolbar, rather than
// as a dropdown. The library has 19 systems and several hundred genres: a
// native <select> shows one value at a time, hides how many there are, and can
// only ever hold one of them. Reading "which systems do I have" and picking
// three of them are the same gesture here.
//
// One group is open at a time (the parent owns `openKey`), so the panel never
// stacks two lists on top of each other and the row below it moves once.

export type FilterOption = { value: string; label: string; count?: number }

export function FilterGroupButton({ label, selected, open, onToggle }: {
  label: string
  selected: string[]
  open: boolean
  onToggle: () => void
}) {
  const active = selected.length > 0
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className={`text-xs px-3 py-2 rounded-lg border min-h-[44px] inline-flex items-center gap-1.5 transition-colors
        ${active
          ? 'border-accent-400 bg-accent-50 text-accent-700 font-semibold dark:bg-accent-500/10'
          : 'border-ink-200 bg-cream-50 text-ink-600 hover:border-ink-300'}
        ${open ? 'ring-2 ring-accent-400' : ''}`}
    >
      <span>{label}</span>
      {active && (
        <span className="px-1.5 py-0.5 rounded-full bg-accent-500 text-white text-[10px] leading-none font-bold">
          {selected.length}
        </span>
      )}
      <span className={`text-[9px] transition-transform ${open ? 'rotate-180' : ''}`}>▼</span>
    </button>
  )
}

export function CheckboxFilterPanel({ label, options, selected, onChange }: {
  label: string
  options: FilterOption[]
  selected: string[]
  onChange: (next: string[]) => void
}) {
  const id = useId()
  const toggle = (value: string) =>
    onChange(selected.includes(value) ? selected.filter(v => v !== value) : [...selected, value])

  return (
    <div className="mt-2 rounded-xl border border-ink-200 bg-cream-50 p-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-400">
          {label} — {options.length} option{options.length === 1 ? '' : 's'}
        </span>
        {selected.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="text-xs text-accent-600 hover:text-accent-800 transition-colors min-h-[44px] px-1"
          >
            Clear {label.toLowerCase()}
          </button>
        )}
      </div>

      {options.length === 0 ? (
        <p className="text-xs text-ink-400">Nothing to filter by yet.</p>
      ) : (
        // Capped height because genre can run to several hundred values once a
        // real library is imported — the panel scrolls instead of pushing the
        // whole grid off screen.
        <div className="max-h-56 overflow-y-auto pr-1">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-3 gap-y-0.5">
            {options.map(o => {
              const checked = selected.includes(o.value)
              return (
                <label
                  key={o.value}
                  htmlFor={`${id}-${o.value}`}
                  className={`flex items-center gap-2 min-h-[44px] px-2 rounded-lg cursor-pointer transition-colors
                    ${checked ? 'bg-accent-50 dark:bg-accent-500/10' : 'hover:bg-ink-50'}`}
                >
                  <input
                    id={`${id}-${o.value}`}
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(o.value)}
                    className="w-4 h-4 flex-shrink-0 accent-accent-500"
                  />
                  <span className={`text-xs truncate ${checked ? 'text-accent-700 font-semibold' : 'text-ink-700'}`} title={o.label}>
                    {o.label}
                  </span>
                  {o.count != null && (
                    <span className="ml-auto text-[10px] text-ink-400 tabular-nums flex-shrink-0">{o.count}</span>
                  )}
                </label>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
