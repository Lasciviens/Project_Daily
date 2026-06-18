import { useState } from 'react'
import { format, isPast } from 'date-fns'
import { useTeamFixtures } from '../hooks/useFootball'
import { getResult, currentClubSeason } from '../types'
import type { Fixture } from '../types'

const RESULT_BORDER: Record<string, string> = {
  W: 'border-l-green-500',
  D: 'border-l-yellow-400',
  L: 'border-l-red-500',
}

const RESULT_BG: Record<string, string> = {
  W: 'bg-green-50',
  D: 'bg-yellow-50',
  L: 'bg-red-50',
}

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  NS:  { label: 'Scheduled', cls: 'bg-ink-100 text-ink-500' },
  '1H': { label: 'Live',     cls: 'bg-red-100 text-red-600' },
  HT:  { label: 'Half Time', cls: 'bg-orange-100 text-orange-600' },
  '2H': { label: 'Live',     cls: 'bg-red-100 text-red-600' },
  FT:  { label: 'FT',        cls: 'bg-green-100 text-green-700' },
  PST: { label: 'Postponed', cls: 'bg-yellow-100 text-yellow-700' },
  CANC:{ label: 'Cancelled', cls: 'bg-red-100 text-red-500' },
  TBD: { label: 'TBD',       cls: 'bg-ink-100 text-ink-400' },
}

interface RowProps { fixture: Fixture; teamId: number }

function FixtureRow({ fixture, teamId }: RowProps) {
  const result  = getResult(fixture, teamId)
  const home    = fixture.teams.home
  const away    = fixture.teams.away
  const status  = STATUS_BADGE[fixture.fixture.status.short] ?? { label: fixture.fixture.status.short, cls: 'bg-ink-100 text-ink-500' }

  const borderCls = result ? RESULT_BORDER[result] : 'border-l-ink-200'
  const bgCls     = result ? RESULT_BG[result]     : ''

  return (
    <div className={`flex items-center gap-3 px-3 py-2.5 min-h-[52px] rounded-lg border-l-4 ${borderCls} ${bgCls}`}>
      {/* Date */}
      <div className="flex-shrink-0 w-10 text-center">
        <p className="text-[10px] text-ink-500 font-medium tabular-nums leading-tight">
          {format(new Date(fixture.fixture.date), 'dd/MM')}
        </p>
        <p className="text-[10px] text-ink-400 tabular-nums leading-tight">
          {format(new Date(fixture.fixture.date), 'HH:mm')}
        </p>
      </div>

      {/* Teams + score */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <img src={home.logo} alt={home.name} className="w-4 h-4 object-contain flex-shrink-0" />
          <p className={`text-xs truncate ${home.id === teamId ? 'font-semibold text-ink-900' : 'text-ink-600'}`}>
            {home.name}
          </p>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <img src={away.logo} alt={away.name} className="w-4 h-4 object-contain flex-shrink-0" />
          <p className={`text-xs truncate ${away.id === teamId ? 'font-semibold text-ink-900' : 'text-ink-600'}`}>
            {away.name}
          </p>
        </div>
      </div>

      {/* Score / status */}
      <div className="flex-shrink-0 text-right">
        {fixture.fixture.status.short === 'FT' ? (
          <p className="text-sm font-bold text-ink-900 tabular-nums">
            {fixture.goals.home} – {fixture.goals.away}
          </p>
        ) : (
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${status.cls}`}>
            {status.label}
          </span>
        )}
        <p className="text-[10px] text-ink-400 mt-0.5 truncate max-w-[80px] text-right">
          {fixture.league.name}
        </p>
      </div>
    </div>
  )
}

interface Props {
  teamId: number
}

const CURRENT = currentClubSeason()
const SEASONS = [CURRENT, CURRENT - 1, CURRENT - 2]

export function FixtureList({ teamId }: Props) {
  const [season, setSeason] = useState(CURRENT)
  const [filter, setFilter] = useState<'all' | 'upcoming' | 'played'>('all')

  const { data: fixtures = [], isLoading, error } = useTeamFixtures(teamId, season)

  const filtered = fixtures
    .filter(f => {
      if (filter === 'upcoming') return !isPast(new Date(f.fixture.date)) || f.fixture.status.short === 'NS'
      if (filter === 'played')   return f.fixture.status.short === 'FT'
      return true
    })
    .sort((a, b) => new Date(a.fixture.date).getTime() - new Date(b.fixture.date).getTime())

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-400">Fixtures</p>
        <div className="flex items-center gap-1.5">
          <select
            value={season}
            onChange={e => setSeason(Number(e.target.value))}
            className="text-xs bg-ink-100 border-none rounded-lg px-2 py-1 text-ink-700 min-h-[32px]"
          >
            {SEASONS.map(s => (
              <option key={s} value={s}>{s}/{String(s + 1).slice(2)}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Filter pills */}
      <div className="flex gap-1 mb-3">
        {(['all', 'upcoming', 'played'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors duration-150 capitalize ${
              filter === f
                ? 'bg-accent-500 border-accent-500 text-white'
                : 'border-ink-200 text-ink-500'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {isLoading && (
        <div className="space-y-2">
          {[1, 2, 3, 4].map(i => <div key={i} className="h-14 bg-cream-200 rounded-lg animate-pulse" />)}
        </div>
      )}

      {error && (
        <p className="text-xs text-red-500 py-2">{(error as Error).message}</p>
      )}

      {!isLoading && !error && filtered.length === 0 && (
        <p className="text-sm text-ink-400 py-4 text-center">No fixtures</p>
      )}

      {!isLoading && !error && (
        <div className="space-y-1.5 max-h-[420px] overflow-y-auto">
          {filtered.map(f => (
            <FixtureRow key={f.fixture.id} fixture={f} teamId={teamId} />
          ))}
        </div>
      )}
    </div>
  )
}
