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
    /** Prefix: every calendar selection's events for one day. */
    dayAll: (date: string) => ['calendar', 'day', date] as const,
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
    entry: (id: string) => ['food-log', 'entry', id] as const,
  },
  mealPlan: {
    all: ['meal-plan'] as const,
    dayNutrition: (date: string) => ['meal-plan', 'day-nutrition', date] as const,
    week: (from: string, to: string) => ['meal-plan', from, to] as const,
    entry: (id: string) => ['meal-plan', 'entry', id] as const,
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
    cinemaVisits: () => ['movies', 'cinema'] as const,
    smartList: (kind: string, id: number) => ['tmdb', 'smart-list', kind, id] as const,
    userTv: () => ['tv', 'user'] as const,
    watched: (tvEntryId: string) => ['watched-episodes', tvEntryId] as const,
    watchedAll: ['watched-episodes'] as const,
    episodeTally: () => ['watched-episodes', 'tally'] as const,
    episodeRows: () => ['watched-episodes', 'rows'] as const,
    nextEpisode: (tvEntryId: string) => ['next-episode', tvEntryId] as const,
    nextEpisodeAll: ['next-episode'] as const,
    recent: () => ['recent-media'] as const,
    tmdb: ['tmdb'] as const,
    /** A TMDB read: ['tmdb', 'trending', 'movie', 'day'] etc. */
    tmdbQuery: (...parts: readonly unknown[]) => ['tmdb', ...parts] as const,
  },
  trakt: {
    all: ['trakt'] as const,
    status: () => ['trakt', 'status'] as const,
    preview: () => ['trakt', 'preview'] as const,
    playback: () => ['trakt', 'playback'] as const,
    calendar: () => ['trakt', 'calendar'] as const,
    lists: () => ['trakt', 'lists'] as const,
    listItems: (id: string | number) => ['trakt', 'lists', 'items', String(id)] as const,
  },
  mediaScores: (type: string, tmdbId: number) => ['media-scores', type, tmdbId] as const,
  mediaReminder: (type: string, tmdbId: number) => ['media-reminder', type, tmdbId] as const,
  mediaFollows: { all: ['media-follows'] as const, list: () => ['media-follows', 'list'] as const, events: () => ['media-follows', 'events'] as const },
  wishes: { all: ['wish-items'] as const },
  books: {
    all: ['books'] as const,
    deliveries: () => ['books', 'deliveries'] as const,
    koboState: () => ['books', 'kobo-state'] as const,
    library: () => ['books', 'library'] as const,
    events: (fromIso: string) => ['books', 'events', fromIso] as const,
    bookEvents: (bookId: string) => ['books', 'book-events', bookId] as const,
    settings: () => ['books', 'reading-settings'] as const,
    koboConfig: () => ['books', 'kobo-config'] as const,
    koboDevice: () => ['books', 'kobo-device'] as const,
    sleepImages: () => ['books', 'sleep-images'] as const,
    aiNotes: (bookId?: string) => ['books', 'ai-notes', bookId ?? 'all'] as const,
  },
  devRequests: { all: ['dev-requests'] as const },
  projects: {
    all: ['projects'] as const,
    list: () => ['projects'] as const,
    stats: () => ['projects', 'stats'] as const,
    phases: (projectId: string) => ['projects', 'phases', projectId] as const,
    items: (projectId: string) => ['projects', 'items', projectId] as const,
  },
  work: {
    all: ['work'] as const,
    note: () => ['work', 'note'] as const,
    links: () => ['work', 'links'] as const,
    goals: (weekStart: string) => ['work', 'goals', weekStart] as const,
    goalsAll: ['work', 'goals'] as const,
  },
  memory: { all: ['ai-memory'] as const },
  athlete: {
    profile: ['athlete-profile'] as const,
    limitations: ['athlete-limitations'] as const,
    musclePrefs: ['athlete-muscle-preferences'] as const,
  },
  hevy: {
    all: ['hevy'] as const,
    workouts: (opts: object) => ['hevy', 'workouts', opts] as const,
    workoutsAll: ['hevy', 'workouts'] as const,
    /** Every workout on the local days [from, to] (calendar, week counts). */
    workoutsRange: (from: string, to: string) => ['hevy', 'workouts', 'range', from, to] as const,
    workout: (id: string) => ['hevy', 'workout', id] as const,
    syncStatus: () => ['hevy', 'sync-status'] as const,
    syncCursor: () => ['hevy', 'sync-cursor'] as const,
    routines: () => ['hevy', 'routines'] as const,
    routineFolders: () => ['hevy', 'routine-folders'] as const,
    templates: () => ['hevy', 'templates'] as const,
    prs: () => ['hevy', 'prs'] as const,
    measurements: (limit?: number) => ['hevy', 'measurements', limit] as const,
    measurementsAll: ['hevy', 'measurements'] as const,
    /** What is stored for one date (the measurement form's fresh read). */
    measurementForDate: (date: string) => ['hevy', 'measurements', 'date', date] as const,
    muscleVolume: (from: string, to: string) => ['hevy', 'muscle-volume', from, to] as const,
    trainingHistory: (from: string) => ['hevy', 'training-history', from] as const,
  },
  strava: { all: ['strava'] as const, activities: (opts: object) => ['strava', 'activities', opts] as const },
  training: {
    all: ['training'] as const,
    stravaStatus: () => ['training', 'strava-status'] as const,
    ptAssessments: ['pt-assessments'] as const,
    exerciseGifDb: ['exercise-gif-db'] as const,
    exerciseGifOverrides: ['exercise-gif-overrides'] as const,
    currentProgram: ['current-program-routines'] as const,
    exerciseTargets: ['exercise-target-overrides'] as const,
    /** Skipped current-program sessions (migration 112), by the first due week read. */
    skipsAll: ['training', 'skips'] as const,
    skips: (fromWeek: string) => ['training', 'skips', fromWeek] as const,
  },
  health: {
    all: ['health'] as const,
    /** Workout rows without the heavy `raw` payload, for a date window. */
    workoutSummaries: (from: string, to: string) => ['health', 'workouts', 'summaries', from, to] as const,
    /** One workout with its `raw` payload (HR curve, route) — loaded on open. */
    workout: (id: string) => ['health', 'workouts', 'detail', id] as const,
    /** Raw points of one metric; every daily/hourly view of it shares this read. */
    metricSeries: (metric: string, from: string, to: string) => ['health', 'metric-series', metric, from, to] as const,
    metricSeriesAll: (metric: string) => ['health', 'metric-series', metric] as const,
    /** Several metrics in ONE request (the mini-card grids). */
    metricBatch: (metrics: readonly string[], from: string, to: string) =>
      ['health', 'metric-batch', [...metrics].sort().join(','), from, to] as const,
    /** Newest reading ever of one metric, on or before a day ('now' = no upper bound). */
    latest: (metric: string, onOrBefore?: string) => ['health', 'latest', metric, onOrBefore ?? 'now'] as const,
    /** The same for several metrics in one query (a different cached shape). */
    latestMany: (metrics: readonly string[], onOrBefore?: string) =>
      ['health', 'latest-many', [...metrics].sort().join(','), onOrBefore ?? 'now'] as const,
    bodyweightAll: ['health', 'bodyweight'] as const,
    bodyweight: (from: string, to: string) => ['health', 'bodyweight', from, to] as const,
    bodyweightLatest: (onOrBefore?: string) => ['health', 'bodyweight', 'latest', onOrBefore ?? 'now'] as const,
    bodyComposition: ['health', 'body-composition-reports'] as const,
    /** Eaten diary totals (date, kcal, protein) for Health → Goal progress (was the cut report). */
    cutDiaryAll: ['health', 'cut-diary'] as const,
    cutDiary: (from: string, to: string) => ['health', 'cut-diary', from, to] as const,
  },
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
    newsArticle: (url: string) => ['news-article', url] as const,
    geolocation: () => ['geolocation'] as const,
    nearbyStops: (lat: number, lon: number) => ['nearby-stops', lat, lon] as const,
    departures: (stopId: string) => ['departures', stopId] as const,
    stopSearch: (query: string) => ['stopSearch', query] as const,
    stopDirections: (stopId: string) => ['stop-directions', stopId] as const,
    trip: (parts: readonly unknown[]) => ['trip', ...parts] as const,
    tripVia: (parts: readonly unknown[]) => ['trip-via', ...parts] as const,
  },
  // The user's own saved transit data (user_transit_stops / _routes / recent searches).
  transit: {
    all: ['transit'] as const,
    stops: () => ['transit', 'stops'] as const,
    routes: () => ['transit', 'routes'] as const,
    recentSearches: () => ['transit', 'recent-searches'] as const,
  },
  // Settings → Subscriptions (service_subscriptions, migration 115).
  subscriptions: {
    all: ['subscriptions'] as const,
    list: () => ['subscriptions', 'list'] as const,
  },
} as const
