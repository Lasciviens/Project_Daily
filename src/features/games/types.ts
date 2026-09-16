// Shared types for the Games feature — reads/writes this app's own `games` /
// `game_platforms` tables (migration 089), no longer the separate RP5
// Supabase project. See CLAUDE.md's Games Feature Detail section for the
// full schema rationale (why game_platforms stayed a real table, why
// systems/emulators/genres/series collapsed to plain columns, etc.).

export type PlayStatus = 'playing' | 'completed' | 'wishlist' | 'backlog' | 'dropped'
export type Tier = 'S' | 'A' | 'B' | 'C' | 'D' | 'F'
export type ExternalSource = 'screenscraper' | 'esde' | 'manual' | 'steam' | 'psn'
/** Which library a row belongs to (migration 096). The Retro Games tab shows
 *  only 'retro'; Stats can scope to any of them. */
export type GameLibrary = 'retro' | 'steam' | 'playstation'
export type EmulatorType = 'standalone' | 'retroarch_core'
export type Performance = 'good' | 'warn' | 'bad'
export type RomStatus = 'missing' | 'found' | 'verified' | 'installed' | 'sd_card'

export interface GamePlatform {
  id:                string
  game_id:           string
  system:            string
  emulator:          string | null
  emulator_type:     EmulatorType | null
  performance:       Performance | null
  performance_notes: string | null
  cover_url:         string | null
  region:            string | null
  rom_status:        RomStatus | null
  rom_url:           string | null
  folder_path:       string | null
  is_primary_variant: boolean
  version_title:     string | null
  rating:            number | null
  release_date:      string | null
  box_url:           string | null
  wheel_url:         string | null
  external_ref:      string | null
  external_source:   ExternalSource | null
  synced_at:         string | null
  needs_review:      boolean
  // Per-variant ES-DE identity + play stats (migration 093). `games.esde_*`
  // is the roll-up ACROSS a game's variants; these are one variant's own.
  esde_system:           string | null
  esde_path:             string | null
  esde_playcount:        number | null
  esde_playtime_seconds: number | null
  esde_last_played:      string | null
  created_at:        string
  updated_at:        string
}

// The row shape as fetched for the Library grid/list — `games.*` plus its
// platforms joined client-side (this app's own aggregation-module
// convention, not a SQL view — see migration 089's header note).
export interface Game {
  id:                    string
  title:                 string
  release_year:          number | null
  publisher:             string | null
  developer:             string | null
  description:           string | null
  storyline:             string | null
  genres:                string[] | null
  series_name:           string | null
  play_status:           PlayStatus
  tier:                  Tier | null
  rating:                number | null
  play_order:            number | null
  is_coop:               boolean
  coop_notes:            string | null
  is_iconic:             boolean
  play_notes:            string | null
  game_log:              string | null
  primary_cover_url:     string | null
  age_rating:            string | null
  players:               string | null
  modes:                 string[] | null
  screenshot_url:        string | null
  fanart_url:            string | null
  external_ref:          string | null
  external_source:       ExternalSource | null
  synced_at:             string | null
  needs_review:          boolean
  library:               GameLibrary
  // Source-neutral play statistics (migration 096): seconds, launches and the
  // last session, whichever provider reported them. The esde_* trio below is
  // ES-DE's own copy and stays for continuity; read THESE.
  play_seconds:          number | null
  play_count:            number | null
  last_played_at:        string | null
  // When the current/last playthrough began and ended — see migration 090.
  // Auto-filled (once, never overwritten) by the quick status-switch action
  // (gamesApi.ts::setPlayStatus); also directly editable.
  started_at:            string | null
  finished_at:           string | null
  esde_playcount:        number | null
  esde_last_played:      string | null
  esde_playtime_seconds: number | null
  created_at:            string
  updated_at:            string
  platforms:             GamePlatform[]
}

export type GameDetail = Game

export type QueueGame = Game & { play_order: number }

// ─── Write inputs ────────────────────────────────────────────────────────────

export interface CreateGameInput {
  title:        string
  release_year?: number | null
  publisher?:    string | null
  developer?:    string | null
  description?:  string | null
  storyline?:    string | null
  genres?:       string[] | null
  series_name?:  string | null
  play_status?:  PlayStatus
  tier?:         Tier | null
  rating?:       number | null
  is_coop?:      boolean
  is_iconic?:    boolean
  play_notes?:   string | null
  primary_cover_url?: string | null
  age_rating?:   string | null
  players?:      string | null
  modes?:        string[] | null
  screenshot_url?: string | null
  fanart_url?:   string | null
  // Optional first platform, added in the same create flow so a game is
  // never left with zero variants (the Library/Queue/Tier views all assume
  // a game is actually playable somewhere).
  system?:       string | null
  emulator?:     string | null
}

export interface GamePatch {
  title?:             string
  release_year?:       number | null
  publisher?:          string | null
  developer?:          string | null
  description?:        string | null
  storyline?:          string | null
  genres?:             string[] | null
  series_name?:        string | null
  play_status?:        PlayStatus
  tier?:               Tier | null
  rating?:             number | null
  play_order?:         number | null
  is_coop?:            boolean
  coop_notes?:         string | null
  is_iconic?:          boolean
  play_notes?:         string | null
  game_log?:           string | null
  primary_cover_url?:  string | null
  age_rating?:         string | null
  players?:            string | null
  modes?:              string[] | null
  screenshot_url?:     string | null
  fanart_url?:         string | null
  started_at?:         string | null
  finished_at?:        string | null
  needs_review?:       boolean
}

export interface GamePlatformInput {
  system:             string
  emulator?:          string | null
  emulator_type?:     EmulatorType | null
  performance?:       Performance | null
  performance_notes?: string | null
  cover_url?:         string | null
  region?:            string | null
  rom_status?:        RomStatus | null
  rom_url?:           string | null
  is_primary_variant?: boolean
  version_title?:     string | null
}

// The Stats panel's computed shape lives in gameStats.ts (GameStatsShape) —
// it is derived from raw rows under the user's chosen window/library filters,
// not a fetch result, so it belongs with the computation.
