import { useState } from 'react'
import { useStandings } from '../hooks/useFootball'
import { currentClubSeason } from '../types'

interface Props {
  leagueId: number
  teamId:   number
}

const CURRENT = currentClubSeason()

export function StandingsTable({ leagueId, teamId }: Props) {
  const [season,   setSeason]   = useState(CURRENT)
  const [expanded, setExpanded] = useState(false)

  const { data: standings = [], isLoading, error } = useStandings(leagueId, season)

  const teamIdx   = standings.findIndex(s => s.team.id === teamId)
  const displayed = expanded
    ? standings
    : standings.slice(Math.max(0, teamIdx - 2), teamIdx + 3)

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-400">Standings</p>
        <select
          value={season}
          onChange={e => setSeason(Number(e.target.value))}
          className="text-xs bg-ink-100 border-none rounded-lg px-2 py-1 text-ink-700 min-h-[32px]"
        >
          {[CURRENT, CURRENT - 1, CURRENT - 2].map(s => (
            <option key={s} value={s}>{s}/{String(s + 1).slice(2)}</option>
          ))}
        </select>
      </div>

      {isLoading && (
        <div className="space-y-1.5">
          {[1, 2, 3, 4, 5].map(i => <div key={i} className="h-8 bg-cream-200 rounded animate-pulse" />)}
        </div>
      )}

      {error && <p className="text-xs text-red-500">{(error as Error).message}</p>}

      {!isLoading && !error && standings.length > 0 && (
        <>
          {/* Header */}
          <div className="grid grid-cols-[1.5rem_1fr_2rem_2rem_2rem_2rem_2.5rem] gap-1 text-[10px] font-semibold text-ink-400 uppercase tracking-wider px-1 mb-1">
            <span>#</span>
            <span>Team</span>
            <span className="text-center">P</span>
            <span className="text-center">W</span>
            <span className="text-center">D</span>
            <span className="text-center">L</span>
            <span className="text-right">Pts</span>
          </div>

          <div className="space-y-0.5">
            {displayed.map(entry => {
              const isMyTeam = entry.team.id === teamId
              return (
                <div
                  key={entry.team.id}
                  className={`grid grid-cols-[1.5rem_1fr_2rem_2rem_2rem_2rem_2.5rem] gap-1 items-center px-1 py-1.5 rounded-lg text-xs ${
                    isMyTeam ? 'bg-accent-500/10 font-semibold' : ''
                  }`}
                >
                  <span className="text-ink-500">{entry.rank}</span>
                  <div className="flex items-center gap-1.5 min-w-0">
                    <img src={entry.team.logo} alt={entry.team.name} className="w-4 h-4 object-contain flex-shrink-0" />
                    <span className={`truncate ${isMyTeam ? 'text-ink-900' : 'text-ink-700'}`}>
                      {entry.team.name}
                    </span>
                  </div>
                  <span className="text-center text-ink-600">{entry.all.played}</span>
                  <span className="text-center text-green-600">{entry.all.win}</span>
                  <span className="text-center text-yellow-600">{entry.all.draw}</span>
                  <span className="text-center text-red-500">{entry.all.lose}</span>
                  <span className={`text-right font-bold ${isMyTeam ? 'text-accent-600' : 'text-ink-800'}`}>
                    {entry.points}
                  </span>
                </div>
              )
            })}
          </div>

          <button
            onClick={() => setExpanded(e => !e)}
            className="w-full mt-2 text-xs text-ink-400 hover:text-accent-600 transition-colors duration-150 min-h-[44px] flex items-center justify-center gap-1"
          >
            {expanded ? '↑ Show less' : `↓ Full table (${standings.length} teams)`}
          </button>
        </>
      )}
    </div>
  )
}
