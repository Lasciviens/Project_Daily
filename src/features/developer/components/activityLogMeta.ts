import type { Tone } from '../../../shared/ui'
import type { AuditLog } from '../hooks/useLogs'
import { formatDistanceToNow } from 'date-fns'
import { formatDateTime } from '../../../shared/utils/dateFormat'

// Friendly, singular labels for the raw table names — every audited table
// (037 and the migrations that attached trg_audit since).
const TABLE_LABEL: Record<string, string> = {
  tasks: 'Task', time_blocks: 'Schedule block',
  recipes: 'Recipe', recipe_ingredients: 'Recipe ingredient',
  recipe_ingredient_library: 'Ingredient', recipe_meal_plans: 'Meal plan',
  shop_categories: 'Shop category', shop_items: 'Shop item', shop_item_costs: 'Shop cost', shop_item_links: 'Shop link',
  projects: 'Project', project_phases: 'Project phase', project_items: 'Project item', project_blocks: 'Project block', project_entries: 'Project entry',
  user_movie_entries: 'Movie', user_tv_entries: 'TV series', user_tv_episodes: 'TV episode', media_watches: 'Watch',
  movie_cinema_visits: 'Cinema visit', media_release_reminders: 'Release reminder',
  user_transit_stops: 'Transit stop', user_transit_routes: 'Transit route',
  work_notes: 'Work note', work_weekly_goals: 'Weekly goal', work_pinned_links: 'Pinned link',
  dev_requests: 'Dev request', wish_items: 'Wish', service_subscriptions: 'Subscription',
  food_log_entries: 'Diary entry', food_favorites: 'Favourite food', food_recent_hidden: 'Hidden recent food',
  day_targets: 'Day target', day_target_profiles: 'Day target profile',
  athlete_profile: 'Athlete profile', athlete_limitations: 'Training limitation',
  athlete_muscle_preferences: 'Muscle preference', current_program_routines: 'Program routine',
  exercise_gif_overrides: 'Exercise GIF fix', exercise_target_overrides: 'Exercise target',
  training_skips: 'Training skip', body_composition_reports: 'Body composition report',
  games: 'Game', game_platforms: 'Game platform', games_prefs: 'Games setting',
  scrape_decisions: 'Scrape decision', screenscraper_prefs: 'ScreenScraper setting',
  books: 'Book', book_deliveries: 'Kobo delivery', reading_settings: 'Reading setting',
  kobo_device_config: 'Kobo setting', kobo_sleep_images: 'Kobo sleep image',
}
/** A table not named above reads as its name, made singular ("media_follows" → "media follow"). */
export function friendlyTable(t: string): string {
  const name = t.replace(/_/g, ' ')
  if (TABLE_LABEL[t]) return TABLE_LABEL[t]
  if (/series$/.test(name)) return name
  return name.replace(/ies$/, 'y').replace(/(ch|sh|x)es$/, '$1').replace(/([^s])s$/, '$1')
}

export const OP_META: Record<AuditLog['operation'], { verb: string; tone: Tone }> = {
  INSERT: { verb: 'created', tone: 'success' },
  UPDATE: { verb: 'updated', tone: 'info' },
  DELETE: { verb: 'deleted', tone: 'danger' },
}

export function fmtLogDate(iso: string): string {
  return formatDateTime(iso)
}

// Best-effort human name for the affected row.
export function rowLabel(log: AuditLog): string {
  const d = log.new_data ?? log.old_data ?? {}
  for (const key of ['title', 'name', 'label', 'message', 'content']) {
    const v = d[key]
    if (typeof v === 'string' && v.trim()) return v.length > 60 ? v.slice(0, 60) + '…' : v
  }
  return log.row_id ? `#${log.row_id.slice(0, 8)}` : '—'
}

/** "3 hours ago" beside an exact timestamp in a detail pane (relativeTime would repeat the clock time for today). */
export function agoLabel(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : formatDistanceToNow(d, { addSuffix: true })
}
