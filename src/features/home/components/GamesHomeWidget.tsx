import { Link } from 'react-router-dom'

export function GamesHomeWidget() {
  return (
    <div className="bg-white rounded-xl border border-ink-200 shadow-sm p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-ink-400 uppercase tracking-wide">Games</h3>
        <Link to="/games" className="text-xs text-accent-600 hover:text-accent-700">Open →</Link>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-2xl">🎮</span>
        <div>
          <p className="text-sm font-medium text-ink-800">Coming soon</p>
          <p className="text-xs text-ink-400">RP5 library integration planned</p>
        </div>
      </div>
    </div>
  )
}
