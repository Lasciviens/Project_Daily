import type { Fixture, FixtureResult } from '../types'
import { getResult } from '../types'
import { format } from 'date-fns'

const RESULT_STYLE: Record<NonNullable<FixtureResult>, string> = {
  W: 'bg-green-500 text-white',
  D: 'bg-yellow-400 text-white',
  L: 'bg-red-500 text-white',
}

interface Props {
  fixtures: Fixture[]
  teamId:   number
}

export function FormGuide({ fixtures, teamId }: Props) {
  const completed = fixtures
    .filter(f => f.fixture.status.short === 'FT')
    .sort((a, b) => new Date(b.fixture.date).getTime() - new Date(a.fixture.date).getTime())
    .slice(0, 5)
    .reverse()

  if (completed.length === 0) return null

  return (
    <div className="card p-4">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-400 mb-3">Form</p>
      <div className="flex items-center gap-2">
        {completed.map(f => {
          const result = getResult(f, teamId)
          if (!result) return null
          const isHome    = f.teams.home.id === teamId
          const opponent  = isHome ? f.teams.away : f.teams.home
          const scoreHome = f.goals.home ?? 0
          const scoreAway = f.goals.away ?? 0
          return (
            <div key={f.fixture.id} className="flex flex-col items-center gap-1 flex-1">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${RESULT_STYLE[result]}`}>
                {result}
              </div>
              <p className="text-[9px] text-ink-500 text-center leading-tight tabular-nums">
                {isHome ? `${scoreHome}–${scoreAway}` : `${scoreAway}–${scoreHome}`}
              </p>
              <p className="text-[9px] text-ink-400 text-center truncate w-full leading-tight">
                {opponent.name.split(' ')[0]}
              </p>
              <p className="text-[9px] text-ink-300 tabular-nums">{format(new Date(f.fixture.date), 'dd/MM')}</p>
            </div>
          )
        })}
      </div>
    </div>
  )
}
