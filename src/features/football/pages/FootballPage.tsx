import { useState } from 'react'
import { isPast } from 'date-fns'
import { TEAM_CONFIG, TOURNAMENTS, currentClubSeason } from '../types'
import { NextMatchHero, NextMatchSkeleton } from '../components/NextMatchHero'
import { FormGuide } from '../components/FormGuide'
import { FixtureList } from '../components/FixtureList'
import { StandingsTable } from '../components/StandingsTable'
import { useTeamFixtures, useTournamentFixtures } from '../hooks/useFootball'

type TeamKey  = keyof typeof TEAM_CONFIG
type MainTab  = 'teams' | 'tournaments'

// ─── My Teams ────────────────────────────────────────────────────────────────

function TeamView({ teamKey }: { teamKey: TeamKey }) {
  const team    = TEAM_CONFIG[teamKey]
  const season  = currentClubSeason()
  const { data: fixtures = [], isLoading } = useTeamFixtures(team.id, season)

  const upcoming = fixtures
    .filter(f => !isPast(new Date(f.fixture.date)) || ['1H','2H','HT','ET','P'].includes(f.fixture.status.short))
    .sort((a, b) => new Date(a.fixture.date).getTime() - new Date(b.fixture.date).getTime())

  const nextMatch = upcoming[0] ?? fixtures
    .filter(f => f.fixture.status.short === 'FT')
    .sort((a, b) => new Date(b.fixture.date).getTime() - new Date(a.fixture.date).getTime())[0]

  return (
    <div className="space-y-3">
      {isLoading ? (
        <NextMatchSkeleton label="Loading fixtures…" />
      ) : nextMatch ? (
        <NextMatchHero fixture={nextMatch} teamId={team.id} />
      ) : (
        <div className="card p-4 text-sm text-ink-400 text-center">No upcoming fixtures</div>
      )}

      {!isLoading && fixtures.length > 0 && (
        <FormGuide fixtures={fixtures} teamId={team.id} />
      )}

      <FixtureList teamId={team.id} />

      {!team.isNational && team.leagueId && (
        <StandingsTable leagueId={team.leagueId} teamId={team.id} />
      )}
    </div>
  )
}

// ─── Tournaments ─────────────────────────────────────────────────────────────

function TournamentCard({ tournament }: { tournament: typeof TOURNAMENTS[0] }) {
  const [open, setOpen] = useState(false)
  const { data: fixtures = [], isLoading } = useTournamentFixtures(
    tournament.id,
    tournament.season,
    undefined
  )

  const byRound = fixtures.reduce<Record<string, typeof fixtures>>((acc, f) => {
    const r = f.league.round
    if (!acc[r]) acc[r] = []
    acc[r].push(f)
    return acc
  }, {})

  return (
    <div className="card overflow-hidden">
      <div className="h-1 bg-ink-800" />
      <div className="p-4">
        <button
          className="w-full flex items-center gap-3 min-h-[44px]"
          onClick={() => setOpen(o => !o)}
        >
          <img src={tournament.logo} alt={tournament.name} className="w-8 h-8 object-contain" />
          <div className="flex-1 text-left">
            <p className="text-sm font-semibold text-ink-900">{tournament.name}</p>
            <p className="text-[11px] text-ink-400">{tournament.season}/{String(tournament.season + 1).slice(2)}</p>
          </div>
          <span className="text-ink-400 text-lg">{open ? '↑' : '↓'}</span>
        </button>

        {open && (
          <div className="mt-3 space-y-3">
            {isLoading && (
              <div className="space-y-2">
                {[1, 2].map(i => <div key={i} className="h-12 bg-cream-200 rounded-lg animate-pulse" />)}
              </div>
            )}
            {!isLoading && Object.entries(byRound).map(([round, roundFixtures]) => (
              <div key={round}>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-400 mb-1.5">{round}</p>
                <div className="space-y-1">
                  {roundFixtures
                    .sort((a, b) => new Date(a.fixture.date).getTime() - new Date(b.fixture.date).getTime())
                    .map(f => (
                      <div key={f.fixture.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-cream-50 text-xs">
                        <img src={f.teams.home.logo} alt="" className="w-4 h-4 object-contain" />
                        <span className="flex-1 truncate text-ink-700">{f.teams.home.name}</span>
                        <span className="font-bold text-ink-900 tabular-nums flex-shrink-0">
                          {f.fixture.status.short === 'FT'
                            ? `${f.goals.home} – ${f.goals.away}`
                            : f.fixture.status.short === 'NS'
                              ? new Date(f.fixture.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
                              : f.fixture.status.short
                          }
                        </span>
                        <span className="flex-1 truncate text-ink-700 text-right">{f.teams.away.name}</span>
                        <img src={f.teams.away.logo} alt="" className="w-4 h-4 object-contain" />
                      </div>
                    ))}
                </div>
              </div>
            ))}
            {!isLoading && Object.keys(byRound).length === 0 && (
              <p className="text-sm text-ink-400 text-center py-2">No fixtures yet</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function FootballPage() {
  const [mainTab,  setMainTab]  = useState<MainTab>('teams')
  const [teamKey,  setTeamKey]  = useState<TeamKey>('galatasaray')

  return (
    <div className="max-w-screen-lg mx-auto px-4 py-6 space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-xl">⚽</span>
        <h1 className="text-lg font-bold text-ink-900">Football</h1>
      </div>

      {/* Main tab bar */}
      <div className="flex gap-1 bg-cream-100 p-1 rounded-xl">
        {([['teams', 'My Teams'], ['tournaments', 'Tournaments']] as const).map(([tab, label]) => (
          <button
            key={tab}
            onClick={() => setMainTab(tab)}
            className={`flex-1 text-sm min-h-[44px] rounded-lg font-medium transition-colors duration-150 ${
              mainTab === tab ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {mainTab === 'teams' && (
        <>
          {/* Team selector */}
          <div className="flex gap-2">
            {(Object.entries(TEAM_CONFIG) as [TeamKey, typeof TEAM_CONFIG[TeamKey]][]).map(([key, team]) => (
              <button
                key={key}
                onClick={() => setTeamKey(key)}
                className={`flex-1 flex items-center justify-center gap-2 min-h-[44px] rounded-xl border-2 transition-colors duration-150 text-sm font-semibold ${
                  teamKey === key
                    ? 'border-accent-500 bg-accent-50 text-accent-700'
                    : 'border-ink-200 bg-white text-ink-600'
                }`}
              >
                {team.name}
              </button>
            ))}
          </div>

          <TeamView key={teamKey} teamKey={teamKey} />
        </>
      )}

      {mainTab === 'tournaments' && (
        <div className="space-y-3">
          {TOURNAMENTS.map(t => (
            <TournamentCard key={t.id} tournament={t} />
          ))}
        </div>
      )}
    </div>
  )
}
