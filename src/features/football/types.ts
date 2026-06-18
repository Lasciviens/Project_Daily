export interface FixtureTeam {
  id:   number
  name: string
  logo: string
}

export interface Fixture {
  fixture: {
    id:     number
    date:   string
    status: { short: string; elapsed: number | null }
    venue:  { name: string | null; city: string | null }
  }
  league: {
    id:     number
    name:   string
    logo:   string
    round:  string
    season: number
  }
  teams: {
    home: FixtureTeam & { winner: boolean | null }
    away: FixtureTeam & { winner: boolean | null }
  }
  goals: { home: number | null; away: number | null }
  score: { halftime: { home: number | null; away: number | null } }
}

export interface StandingEntry {
  rank:      number
  team:      { id: number; name: string; logo: string }
  points:    number
  goalsDiff: number
  form:      string | null
  all: {
    played: number
    win:    number
    draw:   number
    lose:   number
    goals:  { for: number; against: number }
  }
}

export interface TeamConfig {
  id:         number
  leagueId:   number | null
  name:       string
  isNational: boolean
}

export const TEAM_CONFIG: Record<string, TeamConfig> = {
  galatasaray: { id: 559,  leagueId: 203,  name: 'Galatasaray', isNational: false },
  turkey:      { id: 21,   leagueId: null,  name: 'Türkiye',     isNational: true  },
}

export const TOURNAMENTS = [
  { id: 2,   name: 'Champions League', season: 2025, logo: 'https://media.api-sports.io/football/leagues/2.png' },
  { id: 1,   name: 'World Cup 2026',   season: 2026, logo: 'https://media.api-sports.io/football/leagues/1.png' },
]

// Returns the season year for club competitions (July = new season starts)
export function currentClubSeason(): number {
  const month = new Date().getMonth() + 1
  const year  = new Date().getFullYear()
  return month >= 7 ? year : year - 1
}

export type FixtureResult = 'W' | 'D' | 'L' | null

export function getResult(fixture: Fixture, teamId: number): FixtureResult {
  if (fixture.fixture.status.short !== 'FT') return null
  const isHome = fixture.teams.home.id === teamId
  const winner = isHome ? fixture.teams.home.winner : fixture.teams.away.winner
  if (winner === null) return 'D'
  return winner ? 'W' : 'L'
}
