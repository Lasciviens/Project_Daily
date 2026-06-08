import { useState } from 'react'
import { useTransitStops } from '../../hooks/useTransitStops'
import { useTransitRoutes } from '../../hooks/useTransitRoutes'
import type { StopResult } from '../../api/ruterApi'
import { StopSearchInput } from './StopSearchInput'

// ─── Stop feedback state type ─────────────────────────────────────────────────

type StopFeedback = { kind: 'success'; msg: string } | { kind: 'error'; msg: string } | null

// ─── Favorite Stops section ───────────────────────────────────────────────────

function FavoriteStops() {
  const { stops, addStop, removeStop, setDefault } = useTransitStops()
  const [showAdd, setShowAdd]   = useState(false)
  const [feedback, setFeedback] = useState<StopFeedback>(null)

  async function handleSelect(stop: StopResult) {
    try {
      await addStop(stop)
      setFeedback({ kind: 'success', msg: 'Stop added ✓' })
      setShowAdd(false)
      setTimeout(() => setFeedback(null), 2500)
    } catch {
      setFeedback({ kind: 'error', msg: 'Failed to add stop' })
    }
  }

  async function handleRemove(id: string) {
    try {
      await removeStop(id)
    } catch { /* error logged in hook */ }
  }

  async function handleSetDefault(id: string) {
    try {
      await setDefault(id)
    } catch { /* error logged in hook */ }
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-xs font-semibold text-ink-600 uppercase tracking-wide">Favorite Stops</h4>
        <button
          onClick={() => setShowAdd(v => !v)}
          className="text-xs text-accent-500 hover:text-accent-700 transition-colors duration-150 min-h-[44px] min-w-[44px] flex items-center justify-end"
        >
          {showAdd ? 'Cancel' : '+ Add Stop'}
        </button>
      </div>

      {stops.length === 0 && !showAdd && (
        <p className="text-xs text-ink-400">No stops saved yet.</p>
      )}

      <ul className="space-y-1.5 mb-2">
        {stops.map(s => (
          <li key={s.id} className="flex items-center gap-2 min-h-[44px]">
            <button
              onClick={() => handleSetDefault(s.id)}
              className="flex-1 text-left"
              title="Set as default"
            >
              <span className="text-sm text-ink-800">{s.stop_name}</span>
              {s.stop_locality && (
                <span className="text-xs text-ink-400 ml-1.5">{s.stop_locality}</span>
              )}
              {s.label && (
                <span className="text-xs text-accent-500 ml-1.5">{s.label}</span>
              )}
            </button>
            {s.is_default && (
              <span className="text-[10px] text-accent-500 font-medium flex-shrink-0">default</span>
            )}
            <button
              onClick={() => handleRemove(s.id)}
              className="text-ink-300 hover:text-red-500 transition-colors duration-150 text-xs min-h-[44px] min-w-[44px] flex items-center justify-center flex-shrink-0"
              title="Remove stop"
            >✕</button>
          </li>
        ))}
      </ul>

      {showAdd && (
        <div className="mb-2">
          <StopSearchInput
            placeholder="Search and add a stop…"
            onSelect={handleSelect}
            autoFocus
          />
        </div>
      )}

      {feedback && (
        <p className={`text-xs mt-1 ${feedback.kind === 'success' ? 'text-green-600' : 'text-red-500'}`}>
          {feedback.msg}
        </p>
      )}
    </section>
  )
}

// ─── Favorite Routes section ──────────────────────────────────────────────────

function FavoriteRoutes() {
  const { routes, addRoute, removeRoute } = useTransitRoutes()
  const [showAdd, setShowAdd]   = useState(false)
  const [label, setLabel]       = useState('')
  const [fromStop, setFromStop] = useState<StopResult | null>(null)
  const [toStop, setToStop]     = useState<StopResult | null>(null)
  const [saving, setSaving]     = useState(false)
  const [feedback, setFeedback] = useState<StopFeedback>(null)

  function resetForm() {
    setLabel('')
    setFromStop(null)
    setToStop(null)
    setShowAdd(false)
  }

  async function handleSave() {
    if (!label.trim() || !fromStop || !toStop) return
    setSaving(true)
    try {
      await addRoute(label.trim(), fromStop, toStop)
      setFeedback({ kind: 'success', msg: 'Route added ✓' })
      resetForm()
      setTimeout(() => setFeedback(null), 2500)
    } catch {
      setFeedback({ kind: 'error', msg: 'Failed to add route' })
    } finally {
      setSaving(false)
    }
  }

  async function handleRemove(id: string) {
    try {
      await removeRoute(id)
    } catch { /* error logged in hook */ }
  }

  const canSave = label.trim().length > 0 && fromStop !== null && toStop !== null

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-xs font-semibold text-ink-600 uppercase tracking-wide">Favorite Routes</h4>
        <button
          onClick={() => setShowAdd(v => !v)}
          className="text-xs text-accent-500 hover:text-accent-700 transition-colors duration-150 min-h-[44px] min-w-[44px] flex items-center justify-end"
        >
          {showAdd ? 'Cancel' : '+ Add Route'}
        </button>
      </div>

      {routes.length === 0 && !showAdd && (
        <p className="text-xs text-ink-400">No routes saved yet.</p>
      )}

      <ul className="space-y-1.5 mb-2">
        {routes.map(r => (
          <li key={r.id} className="flex items-center gap-2 min-h-[44px]">
            <div className="flex-1 min-w-0">
              <span className="text-sm text-ink-800">{r.label}</span>
              <p className="text-xs text-ink-400 truncate">{r.from_stop_name} → {r.to_stop_name}</p>
            </div>
            <button
              onClick={() => handleRemove(r.id)}
              className="text-ink-300 hover:text-red-500 transition-colors duration-150 text-xs min-h-[44px] min-w-[44px] flex items-center justify-center flex-shrink-0"
              title="Remove route"
            >✕</button>
          </li>
        ))}
      </ul>

      {showAdd && (
        <div className="space-y-2.5 p-3 bg-cream-50 rounded-lg border border-ink-200">
          <input
            value={label}
            onChange={e => setLabel(e.target.value)}
            placeholder='Label (e.g. "Home" or "Work")'
            className="w-full px-3 py-2 text-sm rounded-lg border border-ink-200 focus:outline-none focus:ring-2 focus:ring-accent-400 bg-white min-h-[44px]"
          />
          <div>
            <p className="text-[10px] text-ink-400 uppercase font-semibold mb-1">From</p>
            {fromStop ? (
              <div className="flex items-center gap-2 px-3 py-2 bg-white border border-ink-200 rounded-lg min-h-[44px]">
                <span className="flex-1 text-sm text-ink-700">{fromStop.name}</span>
                <button
                  onClick={() => setFromStop(null)}
                  className="text-ink-300 hover:text-ink-600 transition-colors duration-150 text-xs min-h-[44px] min-w-[44px] flex items-center justify-center"
                >✕</button>
              </div>
            ) : (
              <StopSearchInput placeholder="Search departure stop…" onSelect={setFromStop} />
            )}
          </div>
          <div>
            <p className="text-[10px] text-ink-400 uppercase font-semibold mb-1">To</p>
            {toStop ? (
              <div className="flex items-center gap-2 px-3 py-2 bg-white border border-ink-200 rounded-lg min-h-[44px]">
                <span className="flex-1 text-sm text-ink-700">{toStop.name}</span>
                <button
                  onClick={() => setToStop(null)}
                  className="text-ink-300 hover:text-ink-600 transition-colors duration-150 text-xs min-h-[44px] min-w-[44px] flex items-center justify-center"
                >✕</button>
              </div>
            ) : (
              <StopSearchInput placeholder="Search destination stop…" onSelect={setToStop} />
            )}
          </div>
          <button
            onClick={handleSave}
            disabled={!canSave || saving}
            className="w-full py-2.5 text-sm font-medium rounded-lg bg-accent-500 text-white hover:bg-accent-600 transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed min-h-[44px]"
          >
            {saving ? 'Saving…' : 'Save Route'}
          </button>
        </div>
      )}

      {feedback && (
        <p className={`text-xs mt-1 ${feedback.kind === 'success' ? 'text-green-600' : 'text-red-500'}`}>
          {feedback.msg}
        </p>
      )}
    </section>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SettingsTab() {
  return (
    <div className="space-y-5">
      <FavoriteStops />
      <div className="border-t border-ink-100" />
      <FavoriteRoutes />
    </div>
  )
}
