import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Cell, CellHeader, CellLink } from './cellKit'
import { usePlayQueue } from '../../../home/hooks/useGames'
import { UnifiedPlanModal } from '../../../../shared/components/plan-modal'
import type { QueueGame } from '../../../home/api/gamesApi'

// 🎮 What to play — the top of the RP5 Play Queue, with "plan a session for
// this day" without leaving Daily. Queue order itself is managed on /games.
export function GamesCard({ date }: { date: string }) {
  const { data: queue = [], isError } = usePlayQueue()
  const [planning, setPlanning] = useState<QueueGame | null>(null)
  const top = queue.slice(0, 3)

  return (
    <Cell>
      <CellHeader icon="🎮" title="Play next" action={<CellLink to="/games">Queue →</CellLink>} />

      {isError || top.length === 0 ? (
        <Link to="/games" className="text-xs text-accent-600 hover:text-accent-700 min-h-[44px] flex items-center">
          {isError ? 'Games library unavailable' : 'Play queue is empty — add games →'}
        </Link>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {top.map((g, i) => (
            <li key={g.id} className="flex items-center gap-2.5">
              {g.cover_url ? (
                <img src={g.cover_url} alt={g.title} className="w-8 h-10 object-cover rounded shrink-0 border border-ink-100" />
              ) : (
                <div className="w-8 h-10 rounded bg-cream-200 flex items-center justify-center text-sm shrink-0">🎮</div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-ink-800 truncate">
                  <span className="text-ink-500 font-normal mr-1">{i + 1}.</span>{g.title}
                </p>
                {g.series_name && <p className="text-[10px] text-ink-500 truncate">{g.series_name}</p>}
              </div>
              <button
                onClick={() => setPlanning(g)}
                className="text-[11px] px-2.5 rounded-lg border border-purple-300 text-purple-700 hover:bg-purple-50 transition-colors shrink-0 min-h-[44px]"
              >
                📅 Plan
              </button>
            </li>
          ))}
        </ul>
      )}

      {planning && (
        <UnifiedPlanModal
          open
          onClose={() => setPlanning(null)}
          mode="schedule"
          config={{ heading: 'Plan a gaming session' }}
          defaults={{ title: `🎮 ${planning.title}`, date, duration: 60, category: 'other', color: 'purple' }}
        />
      )}
    </Cell>
  )
}
