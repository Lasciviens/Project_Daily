import { useState, useEffect } from 'react'
import { fetchStopDirections, quayLabel, type QuayDirectionHint } from '../../api/ruterApi'

// ─────────────────────────────────────────────────────────────────────────────
//  Shared "save this stop" panel — used from the Departures tab's ad-hoc search
//  result AND from Settings' "Add a stop" flow, so both paths have full parity
//  (direction/platform choice + a label, with one-tap Home/Work presets).
//
//  A stop can have several platforms, each serving a different direction — this
//  panel is deliberately explicit about that (an intro line + a clear label per
//  card) since picking the wrong one means departures show the wrong direction.
//  For an address favorite (no NSR stop id) there's no platform to choose, so
//  that whole section is skipped.
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
  const isAddress = !stopId.startsWith('NSR:')

  const [quays, setQuays]           = useState<QuayDirectionHint[]>([])
  const [loading, setLoading]       = useState(!isAddress)
  const [selectedQuay, setSelected] = useState<QuayDirectionHint | 'all' | null>(isAddress ? 'all' : null)
  const [label, setLabel]           = useState(stopName)
  const [saving, setSaving]         = useState(false)

  useEffect(() => {
    if (isAddress) return
    let cancelled = false
    fetchStopDirections(stopId)
      .then(data => { if (!cancelled) { setQuays(data); setLoading(false) } })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [stopId, isAddress])

  async function handleSave() {
    if (!selectedQuay) return
    setSaving(true)
    try {
      const quayId   = selectedQuay === 'all' ? null : selectedQuay.quayId
      const quayDesc = selectedQuay === 'all' ? null : quayLabel(selectedQuay)
      await onSave(quayId, quayDesc, label)
    } finally {
      // Always clears the spinner — a real bug this fixes: if onSave threw
      // (e.g. a save conflict), "Saving…" used to stay stuck forever because
      // nothing ever reset it back to false on the error path.
      setSaving(false)
    }
  }

  return (
    <div className="mt-2 p-3 rounded-xl border border-ink-200 bg-cream-50 space-y-3">
      {!isAddress && (
        <>
          <div>
            <p className="text-[11px] font-semibold text-ink-600 uppercase tracking-wide">Which platform?</p>
            <p className="text-[11px] text-ink-400 mt-0.5">
              Bigger stops have several platforms, each toward a different direction. Pick the one you'll actually use — or "All directions" to see every departure from this stop.
            </p>
          </div>

          {loading && <p className="text-xs text-ink-400">Looking up platforms…</p>}

          {!loading && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                onClick={() => setSelected('all')}
                className={`text-left text-xs px-3 py-2.5 rounded-lg border-2 transition-colors duration-150 min-h-[52px] flex flex-col justify-center ${
                  selectedQuay === 'all'
                    ? 'bg-accent-50 border-accent-400 text-accent-800'
                    : 'text-ink-700 border-ink-200 hover:border-ink-300 bg-cream-50'
                }`}
              >
                <span className="font-semibold">All directions</span>
                <span className="text-[10px] opacity-70">Every departure from this stop</span>
              </button>
              {quays.map(q => {
                const selected = selectedQuay !== 'all' && (selectedQuay as QuayDirectionHint | null)?.quayId === q.quayId
                return (
                  <button
                    key={q.quayId}
                    onClick={() => setSelected(q)}
                    className={`text-left text-xs px-3 py-2.5 rounded-lg border-2 transition-colors duration-150 min-h-[52px] flex flex-col justify-center gap-0.5 ${
                      selected
                        ? 'bg-accent-50 border-accent-400 text-accent-800'
                        : 'text-ink-700 border-ink-200 hover:border-ink-300 bg-cream-50'
                    }`}
                  >
                    <span className="font-semibold truncate">
                      {q.publicCode ? `Platform ${q.publicCode}` : 'Platform'}
                    </span>
                    <span className="text-[10px] opacity-70 truncate">{quayLabel(q)}</span>
                  </button>
                )
              })}
            </div>
          )}
        </>
      )}

      {isAddress && (
        <p className="text-[11px] text-ink-400">
          This is an address, not a transit stop — it'll be saved for trip planning (no live departures board).
        </p>
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
          {saving ? 'Saving…' : 'Save'}
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
