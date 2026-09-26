import { Link } from 'react-router-dom'
import { CalendarPlus, Gamepad2 } from 'lucide-react'
import { Cell, CellHeader, CellLink } from './cellKit'
import { usePlayQueue } from '../../../games/hooks/useGames'
import { useEntityModal } from '../../../../shared/modals'
import type { QueueGame } from '../../../games/types'

// What to play — the top of the Play Queue, with "plan a session for this day"
// without leaving Daily. Queue order itself is managed on /games.
export function GamesCard({ date }: { date: string }) {
  const { data: queue = [], isError } = usePlayQueue()
  const modal = useEntityModal()
  const top = queue.slice(0, 3)

  const plan = (g: QueueGame) => modal.open({
    kind: 'time-block',
    config: { heading: 'Plan a gaming session' },
    defaults: { title: g.title, date, duration: 60, category: 'games', color: 'purple' },
  })

  return (
    <Cell>
      <CellHeader icon={<Gamepad2 />} title="Play next" action={<CellLink to="/games">Queue</CellLink>} />

      {isError || top.length === 0 ? (
        <Link to="/games" className="flex min-h-[44px] items-center text-body text-fg-muted hover:text-accent-600">
          {isError ? 'Games library unavailable' : 'Play queue is empty — add games'}
        </Link>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {top.map((g, i) => (
            <li key={g.id} className="flex items-center gap-2.5">
              {g.primary_cover_url ? (
                <img src={g.primary_cover_url} alt="" className="h-10 w-8 shrink-0 rounded-[6px] border border-line object-cover" />
              ) : (
                <div className="grid h-10 w-8 shrink-0 place-items-center rounded-[6px] bg-surface-2 text-fg-faint">
                  <Gamepad2 className="h-4 w-4" aria-hidden />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-body font-semibold text-fg">
                  <span className="mr-1 font-normal tabular-nums text-fg-muted">{i + 1}.</span>{g.title}
                </p>
                {g.series_name && <p className="truncate text-meta text-fg-muted">{g.series_name}</p>}
              </div>
              <button
                type="button"
                onClick={() => plan(g)}
                aria-label={`Plan a session of ${g.title}`}
                className="icon-btn-bordered shrink-0 [&_svg]:h-4 [&_svg]:w-4"
              >
                <CalendarPlus aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Cell>
  )
}
