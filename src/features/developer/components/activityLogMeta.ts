import type { Tone } from '../../../shared/ui'
import type { AuditLog } from '../hooks/useLogs'

// Friendly, singular labels for the raw table names.
const TABLE_LABEL: Record<string, string> = {
  tasks: 'Task', time_blocks: 'Schedule block',
  recipes: 'Recipe', recipe_ingredients: 'Recipe ingredient',
  recipe_ingredient_library: 'Ingredient', recipe_meal_plans: 'Meal plan',
  shop_categories: 'Shop category', shop_items: 'Shop item',
  projects: 'Project', project_phases: 'Project phase', project_items: 'Project item',
  user_movie_entries: 'Movie', user_tv_entries: 'TV series', user_tv_episodes: 'TV episode',
  user_transit_stops: 'Transit stop', user_transit_routes: 'Transit route',
  work_notes: 'Work note', work_weekly_goals: 'Weekly goal', work_pinned_links: 'Pinned link',
  dev_requests: 'Dev request',
}
export const friendlyTable = (t: string) => TABLE_LABEL[t] ?? t.replace(/_/g, ' ')

export const OP_META: Record<AuditLog['operation'], { verb: string; tone: Tone }> = {
  INSERT: { verb: 'created', tone: 'success' },
  UPDATE: { verb: 'updated', tone: 'info' },
  DELETE: { verb: 'deleted', tone: 'danger' },
}
