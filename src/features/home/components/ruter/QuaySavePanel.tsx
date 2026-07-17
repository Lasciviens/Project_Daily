import { useState, useEffect } from 'react'
import { fetchStopDirections, type QuayDirectionHint } from '../../api/ruterApi'

// ─────────────────────────────────────────────────────────────────────────────
//  Shared "save this stop" panel — used from the Departures tab's ad-hoc search
//  result AND from Settings' "Add a stop" flow, so both paths have full parity
//  (quay/direction choice + a label, with one-tap Home/Work presets).
// ─────────────────────────────────────────────────────────────────────────────

interface QuaySavePanelProps {
  stopId:   string
  stopName: string
  onSave:   (quayId: string | null, quayDescription: string | null, label: string) => Promise<void>
  onCancel: () => void
}

const LABEL_PRESETS = [
  { emoji: '🏠', label: 'Home' },
  { emoji: '💼', label: 'Work' },
]

export function QuaySavePanel({ stopId, stopName, onSave, onCancel }: QuaySavePanelProps) {
  const [quays, setQuays]           = useState<QuayDirectionHint[]>([])
  const [loading, setLoading]       = useState(true)
  const [selectedQuay, setSelected] = useState<QuayDirectionHint | 'all' | null>(null)
  const [label, setLabel]           = useState(stopName)
  const [saving, setSaving]         = useState(false)

  useEffect(() => {
    let cancelled = false
    fetchStopDirections(stopId)
      .then(data => { if (!cancelled) { setQuays(data); setLoading(false) } })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [stopId])

  async function handleSave() {
    if (!selectedQuay) return
    setSaving(true)
    const quayId   = selectedQuay === 'all' ? null : selectedQuay.quayId
    const quayDesc = selectedQuay === 'all' ? null : (selectedQuay.description ?? selectedQuay.fallback ?? (selectedQuay.publicCode ? `Platform ${selectedQuay.publicCode}` : null))
    await onSave(quayId, quayDesc, label)
    setSaving(false)
  }

  return (
    <div className="mt-2 p-3 rounded-xl border border-ink-200 bg-cream-50 space-y-3">
      <p className="text-[11px] font-semibold text-ink-600 uppercase tracking-wide">Choose direction to save</p>

      {loading && <p className="text-xs text-ink-400">Loading quays…</p>}

      {!loading && (
        <div className="flex flex-col gap-1.5">
          <button
            onClick={() => setSelected('all')}
            className={`text-left text-xs px-3 py-2 rounded-lg border transition-colors duration-150 min-h-[44px] ${
              selectedQuay === 'all'
                ? 'bg-accent-500 text-white border-accent-500'
                : 'text-ink-700 border-ink-200 hover:border-accent-300 bg-cream-50'
            }`}
          >
            All quays
          </button>
          {quays.map(q => {
            const label2 = q.description ?? q.fallback ?? (q.publicCode ? `Platform ${q.publicCode}` : q.quayId)
            const hint   = q.lines.length > 0 ? q.lines.slice(0, 4).join(', ') : null
            return (
              <button
                key={q.quayId}
                onClick={() => setSelected(q)}
                className={`text-left text-xs px-3 py-2 rounded-lg border transition-colors duration-150 min-h-[44px] ${
                  selectedQuay !== 'all' && (selectedQuay as QuayDirectionHint)?.quayId === q.quayId
                    ? 'bg-accent-500 text-white border-accent-500'
                    : 'text-ink-700 border-ink-200 hover:border-accent-300 bg-cream-50'
                }`}
              >
                <span className="font-medium">{label2}</span>
                {hint && <span className="ml-1.5 opacity-70">{hint}</span>}
              </button>
            )
          })}
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-[10px] font-semibold text-ink-400 uppercase tracking-wide">Label</label>
          {/* One-tap Home/Work presets — the whole point being asked for: naming
              a saved stop shouldn't require typing it out every time. */}
          <div className="flex gap-1">
            {LABEL_PRESETS.map(p => (
              <button
                key={p.label}
                type="button"
                onClick={() => setLabel(p.label)}
                className={`text-[11px] px-2 py-1 rounded-full border transition-colors duration-150 min-h-[28px] ${
                  label === p.label
                    ? 'bg-accent-500 text-white border-accent-500'
                    : 'text-ink-600 border-ink-200 hover:border-accent-300 bg-cream-50'
                }`}
              >
                {p.emoji} {p.label}
              </button>
            ))}
          </div>
        </div>
        <input
          value={label}
          onChange={e => setLabel(e.target.value)}
          className="w-full px-3 py-2 text-sm rounded-lg border border-ink-200 focus:outline-none focus:ring-2 focus:ring-accent-400 bg-cream-50 min-h-[44px]"
        />
      </div>

      <div className="flex gap-2">
        <button
          onClick={handleSave}
          disabled={!selectedQuay || saving}
          className="flex-1 text-sm font-medium px-3 py-2 rounded-lg bg-accent-500 text-white min-h-[44px] disabled:opacity-50 hover:bg-accent-600 transition-colors duration-150"
        >
          {saving ? 'Saving…' : 'Save stop'}
        </button>
        <button
          onClick={onCancel}
          className="text-sm px-3 py-2 rounded-lg border border-ink-200 text-ink-600 min-h-[44px] hover:border-ink-400 transition-colors duration-150"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
