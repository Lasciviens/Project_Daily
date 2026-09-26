import { useState } from 'react'
import { Briefcase, Home } from 'lucide-react'
import { quayLabel, type QuayDirectionHint } from '../../api/ruterApi'
import { useStopDirections } from '../../hooks/useTransitQueries'
import { Button, SectionLabel, cx } from '../../../../shared/ui'

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
  { icon: Home, label: 'Home' },
  { icon: Briefcase, label: 'Work' },
]

const choiceClass = (selected: boolean) => cx(
  'flex min-h-[52px] flex-col justify-center gap-0.5 rounded-control border px-3 py-2 text-left text-meta transition-colors duration-150',
  selected ? 'border-accent-500 bg-accent-50 text-accent-700' : 'border-line bg-surface text-fg-2 hover:bg-surface-hover',
)

export function QuaySavePanel({ stopId, stopName, onSave, onCancel }: QuaySavePanelProps) {
  const isAddress = !stopId.startsWith('NSR:')

  const { data: quays = [], isLoading: loading } = useStopDirections(isAddress ? null : stopId)
  const [selectedQuay, setSelected] = useState<QuayDirectionHint | 'all' | null>(isAddress ? 'all' : null)
  const [label, setLabel]           = useState(stopName)
  const [saving, setSaving]         = useState(false)

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
    <div className="mt-2 space-y-3 rounded-row border border-line bg-surface-2 p-3">
      {!isAddress && (
        <>
          <div>
            <SectionLabel>Which platform?</SectionLabel>
            <p className="mt-0.5 text-meta text-fg-muted">
              Bigger stops have several platforms, each toward a different direction. Pick the one you'll actually use — or "All directions" to see every departure from this stop.
            </p>
          </div>

          {loading && <p className="text-meta text-fg-muted">Looking up platforms…</p>}

          {!loading && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setSelected('all')}
                aria-pressed={selectedQuay === 'all'}
                className={choiceClass(selectedQuay === 'all')}
              >
                <span className="font-semibold">All directions</span>
                <span className="text-micro opacity-70">Every departure from this stop</span>
              </button>
              {quays.map(q => {
                const selected = selectedQuay !== 'all' && (selectedQuay as QuayDirectionHint | null)?.quayId === q.quayId
                return (
                  <button
                    key={q.quayId}
                    type="button"
                    onClick={() => setSelected(q)}
                    aria-pressed={selected}
                    className={choiceClass(selected)}
                  >
                    <span className="font-semibold truncate">
                      {q.publicCode ? `Platform ${q.publicCode}` : 'Platform'}
                    </span>
                    <span className="text-micro opacity-70 truncate">{quayLabel(q)}</span>
                  </button>
                )
              })}
            </div>
          )}
        </>
      )}

      {isAddress && (
        <p className="text-meta text-fg-muted">
          This is an address, not a transit stop — it'll be saved for trip planning (no live departures board).
        </p>
      )}

      <div>
        <div className="flex items-center justify-between mb-1">
          <label htmlFor={`quay-label-${stopId}`} className="section-label">Label</label>
          {/* One-tap Home/Work presets — the whole point being asked for: naming
              a saved stop shouldn't require typing it out every time. */}
          <div className="flex gap-1">
            {LABEL_PRESETS.map(p => (
              <button
                key={p.label}
                type="button"
                onClick={() => setLabel(p.label)}
                aria-pressed={label === p.label}
                className="pill-tab h-[36px] px-3"
              >
                <p.icon aria-hidden className="h-3.5 w-3.5" /> {p.label}
              </button>
            ))}
          </div>
        </div>
        <input id={`quay-label-${stopId}`} value={label} onChange={e => setLabel(e.target.value)} className="input w-full" />
      </div>

      <div className="flex gap-2">
        <Button variant="primary" onClick={handleSave} disabled={!selectedQuay} loading={saving} className="flex-1">Save stop</Button>
        <Button onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  )
}
