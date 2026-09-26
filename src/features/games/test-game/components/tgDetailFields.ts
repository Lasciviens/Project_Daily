import { formatPlaytime } from '../../api/playtimeFormat'
import { formatDay, platformInfo, playCount, resolveSystemKey, type TgGame } from '../testGameModel'
import type { GameLibrary, GamePlatform } from '../../types'

// Every non-empty field of a game row and its platform variants, grouped for
// the detail screen's "Details" block. Pure — no React — so the whole record
// reads the same wherever it is shown.
//
// Left out on purpose: the fields the card already shows above this block
// (title, status, stars and rating, playtime, last played, developer, publisher, the
// description) and plumbing no reader needs (ids, cover/media URLs, hashes).

export interface DetailRow {
  label: string
  value: string
  /** Chips instead of one line (genres, modes). */
  chips?: string[]
  /** A paragraph (notes, a log) rather than a short value. */
  long?: boolean
}

export interface DetailSection { key: string; title: string; rows: DetailRow[] }

export interface PlatformVariant { id: string; name: string; primary: boolean; rows: DetailRow[] }

const LIBRARY_TEXT: Record<GameLibrary, string> = { retro: 'Retro', steam: 'Steam', playstation: 'PlayStation' }
const SOURCE_TEXT: Record<string, string> = {
  screenscraper: 'ScreenScraper', esde: 'ES-DE', manual: 'Added by hand', steam: 'Steam', psn: 'PlayStation Network',
}
const ROM_TEXT: Record<string, string> = { sd_card: 'On SD card', installed: 'Installed', verified: 'Verified', found: 'Found', missing: 'Missing' }
const PERF_TEXT: Record<string, string> = { good: 'Runs well', warn: 'Some issues', bad: 'Poor' }

const clean = (s: string | null | undefined) => (s ?? '').trim()
const list = (xs: string[] | null | undefined) => (xs ?? []).map(x => x.trim()).filter(Boolean)
const count = (n: number | null | undefined, one: string, many: string) =>
  n != null && n > 0 ? `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}` : ''
const hours = (seconds: number | null | undefined) => (seconds != null && seconds > 0 ? formatPlaytime(seconds / 60) : '')
/** "sd_card" → "Sd card": a label, not a code. */
const words = (s: string | null | undefined) => { const t = clean(s).replace(/_/g, ' '); return t && t[0].toUpperCase() + t.slice(1) }
const day = (iso: string | null | undefined) => (iso ? formatDay(iso) : '')
/** The last path segment — a ROM's file name reads better than its folder. */
const fileName = (path: string | null | undefined) => clean(path).split(/[\\/]/).filter(Boolean).pop() ?? ''

function rows(xs: (DetailRow | false | null | undefined)[]): DetailRow[] {
  return xs.filter((r): r is DetailRow => !!r && (r.value !== '' || (r.chips?.length ?? 0) > 0))
}

function variantRows(p: GamePlatform): DetailRow[] {
  const emulator = [clean(p.emulator), p.emulator_type === 'retroarch_core' ? 'RetroArch core' : p.emulator_type === 'standalone' ? 'standalone' : '']
    .filter(Boolean).join(' · ')
  const perf = [PERF_TEXT[p.performance ?? ''] ?? words(p.performance), clean(p.performance_notes)]
    .filter(Boolean).join(' — ')
  const source = [SOURCE_TEXT[p.external_source ?? ''] ?? clean(p.external_source), clean(p.external_ref)].filter(Boolean).join(' · ')
  return rows([
    { label: 'Version', value: clean(p.version_title) },
    { label: 'Emulator', value: emulator },
    { label: 'Region', value: clean(p.region) },
    { label: 'ROM', value: ROM_TEXT[p.rom_status ?? ''] ?? words(p.rom_status) },
    { label: 'File', value: fileName(p.esde_path) || fileName(p.rom_url) },
    { label: 'Folder', value: clean(p.folder_path) },
    { label: 'Performance', value: perf },
    { label: 'Release date', value: day(p.release_date) },
    // 0–100: ES-DE's 0–1 rating or ScreenScraper's /20 score, scaled.
    { label: 'Rating', value: p.rating != null ? `${p.rating}/100` : '' },
    { label: 'Plays', value: count(p.esde_playcount, 'launch', 'launches') },
    { label: 'Playtime', value: hours(p.esde_playtime_seconds) },
    { label: 'Last played', value: day(p.esde_last_played) },
    { label: 'Source', value: source },
    { label: 'Synced', value: day(p.synced_at) },
    p.needs_review && { label: 'Review', value: 'Flagged for review' },
  ])
}

export function platformVariants(game: TgGame): PlatformVariant[] {
  // Primary first, then as stored.
  return [...game.platforms]
    .sort((a, b) => Number(b.is_primary_variant) - Number(a.is_primary_variant))
    .map(p => ({ id: p.id, name: platformInfo(resolveSystemKey(p.system)).name || p.system, primary: p.is_primary_variant, rows: variantRows(p) }))
}

/** About · Your progress · Source. Platforms are separate (`platformVariants`),
 *  and the storyline is a text block of its own (TgDetailDescription). */
export function detailSections(game: TgGame): DetailSection[] {
  const finishedShown = game.play_status === 'completed' && !!game.finished_at // TgDetailInfo shows it
  const isSteam = game.library === 'steam'
  const flags = [game.is_iconic && 'Iconic', game.is_coop && 'Co-op'].filter((x): x is string => !!x)

  const about = rows([
    { label: 'Released', value: game.release_year ? String(game.release_year) : '' },
    { label: 'Series', value: clean(game.series_name) },
    { label: 'Genres', value: '', chips: list(game.genres) },
    { label: 'Modes', value: '', chips: list(game.modes) },
    { label: 'Players', value: clean(game.players) },
    { label: 'Age rating', value: clean(game.age_rating) },
    { label: 'Flags', value: '', chips: flags },
    { label: 'Co-op notes', value: clean(game.coop_notes), long: true },
  ])
  const progress = rows([
    // The live figure (ES-DE's own columns for retro rows), never the frozen
    // migration-096 snapshot in games.play_count.
    { label: 'Plays', value: count(playCount(game), 'launch', 'launches') },
    { label: 'Started', value: day(game.started_at) },
    // A finish date on a game that is no longer Completed (a replay, or a
    // status changed back) is history, not the current state.
    !finishedShown && { label: game.play_status === 'completed' ? 'Finished' : 'Previously finished', value: day(game.finished_at) },
    { label: 'Game log', value: clean(game.game_log), long: true },
  ])
  const source = rows([
    { label: 'Library', value: LIBRARY_TEXT[game.library] ?? '' },
    { label: 'Source', value: SOURCE_TEXT[game.external_source ?? ''] ?? clean(game.external_source) },
    { label: isSteam ? 'Steam app ID' : 'Reference', value: clean(game.external_ref) },
    { label: 'ScreenScraper', value: game.ss_jeu_id ? `#${game.ss_jeu_id}${game.ss_scraped_at ? ` · scraped ${formatDay(game.ss_scraped_at)}` : ''}` : '' },
    { label: 'Synced', value: day(game.synced_at) },
    game.needs_review && { label: 'Review', value: 'Flagged for review' },
    { label: 'Added', value: day(game.created_at) },
    { label: 'Updated', value: day(game.updated_at) },
  ])

  return [
    { key: 'about', title: 'About', rows: about },
    { key: 'progress', title: 'Your progress', rows: progress },
    { key: 'source', title: 'Source', rows: source },
  ].filter(s => s.rows.length > 0)
}
