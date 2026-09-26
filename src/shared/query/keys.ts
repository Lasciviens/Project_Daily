// ─────────────────────────────────────────────────────────────────────────────
//  Query keys — the ONE place key arrays are written (THEME.md §10).
//
//  Each namespace has an `all` root: invalidating the root refreshes every
//  query below it (TanStack prefix match). Builders return the exact values
//  the app already used, so moving a call site onto `qk` changes nothing at
//  runtime. New queries MUST add their key here, never inline a literal.
// ─────────────────────────────────────────────────────────────────────────────

export const qk = {
  tasks: {
    all: ['tasks'] as const,
    list: () => ['tasks', 'all'] as const,
    section: (section: string) => ['tasks', 'section', section] as const,
    trainingOpen: () => ['tasks', 'training-session-open'] as const,
    day: (date: string, section: string) => ['tasks', 'day', date, section] as const,
    week: (from: string, to: string) => ['tasks', 'week', from, to] as const,
    month: (from: string, to: string) => ['tasks', 'month', from, to] as const,
    work: () => ['tasks', 'work'] as const,
    byId: (id: string) => ['tasks', 'by-id', id] as const,
    byIds: (ids: readonly string[]) => ['tasks', 'by-ids', [...ids].sort().join(',')] as const,
    subtasks: (parentId: string) => ['tasks', 'subtasks', parentId] as const,
  },
  googleTaskLists: { all: ['google-task-lists'] as const },
  schedule: {
    all: ['schedule'] as const,
    day: (date: string) => ['schedule', 'day', date] as const,
    trainingRange: (from: string, to: string) => ['schedule', 'training-range', from, to] as const,
    templates: () => ['schedule', 'blocks'] as const,
    block: (id: string) => ['schedule', 'block', id] as const,
    byTask: (taskId: string) => ['schedule', 'by-task', taskId] as const,
  },
  calendar: {
    all: ['calendar'] as const,
    list: () => ['calendar', 'list'] as const,
    day: (date: string, calIds: string) => ['calendar', 'day', date, calIds] as const,
    range: (from: string, to: string, calIds: string) => ['calendar', 'range', from, to, calIds] as const,
    dates: (from: string, to: string, calIds: string) => ['calendar', 'dates', from, to, calIds] as const,
  },
  // Food: the diary (food_log_entries) is read under two roots today.
  foodLog: {
    all: ['food-log'] as const,
    day: (date: string) => ['food-log', date] as const,
    range: (from: string, to: string) => ['food-log', 'range', from, to] as const,
    recents: () => ['food-log', 'recent-foods'] as const,
    recentSupplements: () => ['food-log', 'recent-supplements'] as const,
    favorites: () => ['food-log', 'favorites'] as const,
    loggedDates: (date: string) => ['food-log', 'logged-dates', date] as const,
  },
  mealPlan: {
    all: ['meal-plan'] as const,
    dayNutrition: (date: string) => ['meal-plan', 'day-nutrition', date] as const,
  },
  water: { all: ['water'] as const, day: (date: string) => ['water', date] as const },
  dayTargets: { all: ['day-targets'] as const, profiles: ['day-target-profiles'] as const },
  recipes: { all: ['recipes'] as const },
  ingredients: { all: ['recipe-ingredient-library'] as const },
  shop: {
    all: ['shop'] as const,
    categories: () => ['shop', 'categories'] as const,
    items: () => ['shop', 'items'] as const,
  },
  media: {
    movies: ['movies'] as const,
    tv: ['tv'] as const,
    userMovies: () => ['movies', 'user'] as const,
    userTv: () => ['tv', 'user'] as const,
    watched: (tvEntryId: string) => ['watched-episodes', tvEntryId] as const,
    watchedAll: ['watched-episodes'] as const,
    nextEpisode: (tvEntryId: string) => ['next-episode', tvEntryId] as const,
    nextEpisodeAll: ['next-episode'] as const,
    recent: () => ['recent-media'] as const,
    tmdb: ['tmdb'] as const,
  },
  wishes: { all: ['wish-items'] as const },
  devRequests: { all: ['dev-requests'] as const },
  projects: { all: ['projects'] as const },
  work: { all: ['work'] as const },
  memory: { all: ['ai-memory'] as const },
  athlete: {
    profile: ['athlete-profile'] as const,
    limitations: ['athlete-limitations'] as const,
    musclePrefs: ['athlete-muscle-preferences'] as const,
  },
  hevy: {
    all: ['hevy'] as const,
    workout: (id: string) => ['hevy', 'workout', id] as const,
    syncStatus: () => ['hevy', 'sync-status'] as const,
  },
  strava: { all: ['strava'] as const, activities: (opts: object) => ['strava', 'activities', opts] as const },
  training: { all: ['training'] as const },
  health: { all: ['health'] as const },
  games: { all: ['games'] as const },
  logs: {
    errors: () => ['error-logs'] as const,
    audit: (filter?: object) => (filter ? ['audit-logs', filter] as const : ['audit-logs'] as const),
    projectActivity: (projectId: string) => ['project-activity', projectId] as const,
  },
  external: {
    weather: (lat: number, lon: number) => ['weather', lat.toFixed(2), lon.toFixed(2)] as const,
    currency: () => ['currency'] as const,
    news: (source: string) => ['news', source] as const,
    geolocation: () => ['geolocation'] as const,
  },
} as const
