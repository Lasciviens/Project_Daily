// Settings → Integrations and APIs: every external API or service the app talks to, as one
// static, typed list. Pure and import-free (verified by
// scripts/verify-api-registry.cjs). Connection STATUS is not repeated here —
// entries with a card on Settings → Subscriptions link there instead.
//
// `since` is the date the entry's key file (`sinceFrom`) first appears in git
// (`git log --diff-filter=A --follow`). The repository's history starts on
// 22.07.2026, so that date means "on or before" (`sinceIsHistoryStart`).
// Secrets are listed by NAME only — values live in Supabase Vault / Edge
// Function secrets and never reach the client.

export type ApiCategory =
  | 'Platform' | 'AI' | 'Productivity' | 'Health' | 'Training' | 'Food'
  | 'Media' | 'Games' | 'Travel' | 'Home' | 'Device'

export const API_CATEGORIES: readonly ApiCategory[] = [
  'Platform', 'AI', 'Productivity', 'Health', 'Training', 'Food',
  'Media', 'Games', 'Travel', 'Home', 'Device',
]

/** How the call is made. */
export type ApiTransport = 'browser' | 'edge' | 'webhook-in' | 'cron' | 'device' | 'cdn'

export const TRANSPORT_LABEL: Record<ApiTransport, string> = {
  browser: 'Browser direct',
  edge: 'Edge function',
  'webhook-in': 'Webhook in',
  cron: 'Cron',
  device: 'From a device',
  cdn: 'Public CDN',
}

export type ApiAuth =
  | 'oauth'          // a real per-user OAuth token
  | 'api-key'        // a provider key kept server-side (or a client-safe key)
  | 'device-secret'  // a static revocable secret held by a device / webhook sender
  | 'session'        // the user's own Supabase session (JWT)
  | 'cookie-token'   // a pasted provider cookie exchanged for tokens (unofficial)
  | 'signed-url'     // HMAC-signed links
  | 'none'

export const AUTH_LABEL: Record<ApiAuth, string> = {
  oauth: 'OAuth',
  'api-key': 'API key',
  'device-secret': 'Device secret',
  session: 'User session',
  'cookie-token': 'Pasted token',
  'signed-url': 'Signed links',
  none: 'No auth',
}

export type ApiDirection = 'read' | 'write' | 'both'

export const DIRECTION_LABEL: Record<ApiDirection, string> = {
  read: 'Reads',
  write: 'Writes',
  both: 'Reads + writes',
}

/** Tones (THEME §2.4), kept next to their enums. Plain strings so this file stays import-free. */
export const DIRECTION_TONE: Record<ApiDirection, 'info' | 'highlight' | 'neutral'> = {
  read: 'info',
  write: 'highlight',
  both: 'neutral',
}
export const OFFICIAL_TONE = { official: 'success', unofficial: 'warn' } as const

export type ApiCost = 'free' | 'paid' | 'free-tier' | 'personal-key'

export const COST_LABEL: Record<ApiCost, string> = {
  free: 'Free',
  paid: 'Paid plan',
  'free-tier': 'Free tier',
  'personal-key': 'Free, personal key',
}

export interface ApiLink { label: string; path: string }
export interface ApiDocLink { label: string; url: string }

export interface ApiEntry {
  id: string
  name: string
  provider: string
  category: ApiCategory
  /** false = reverse-engineered / community / undocumented. */
  official: boolean
  /** The provider's API documentation. */
  docsUrl: string
  moreDocs?: ApiDocLink[]
  purpose: string
  transports: ApiTransport[]
  /** How it is wired, in one or two plain sentences. */
  connection: string
  edgeFunctions?: string[]
  /** Base URLs / hosts actually called. */
  endpoints?: string[]
  auth: ApiAuth
  authNote?: string
  /** Secret NAMES only. */
  secrets?: string[]
  direction: ApiDirection
  cadence: string
  usedIn: ApiLink[]
  /** Tables the data lands in (or is read from). */
  tables?: string[]
  migrations?: string[]
  cost?: ApiCost
  limits?: string
  caveats?: string[]
  /** DD.MM.YYYY */
  since: string
  sinceFrom: string
  sinceIsHistoryStart?: boolean
  /** Has a card (connect / status) on Settings → Subscriptions. */
  hasIntegrationCard?: boolean
}

export const INTEGRATIONS_PATH = '/settings?tab=subscriptions'
const H0 = '22.07.2026'

export const API_REGISTRY: readonly ApiEntry[] = [
  // ── Platform ───────────────────────────────────────────────────────────
  {
    id: 'supabase', name: 'Supabase', provider: 'Supabase', category: 'Platform', official: true,
    docsUrl: 'https://supabase.com/docs',
    moreDocs: [{ label: 'Edge Functions', url: 'https://supabase.com/docs/guides/functions' }],
    purpose: 'The app\'s backend: Postgres database with row-level security, sign-in, file storage and the edge functions every server-side integration runs in.',
    transports: ['browser', 'edge', 'cron'],
    connection: 'The browser talks to Supabase directly with the signed-in session; edge functions use the platform-injected service role server-side. pg_cron runs the scheduled jobs.',
    endpoints: ['<project>.supabase.co/rest/v1', '/auth/v1', '/storage/v1', '/functions/v1'],
    auth: 'session', authNote: 'Anon key + the user\'s JWT in the browser; the service-role key exists only inside edge functions.',
    secrets: ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY (platform-injected)'],
    direction: 'both', cadence: 'Every page, on demand (TanStack Query caching)',
    usedIn: [{ label: 'Everywhere', path: '/home' }, { label: 'Activity log', path: '/developer?tab=activity' }],
    cost: 'free-tier', limits: 'Free plan: 1 GB storage — over it the project goes read-only, so game media copies stop at an 850 MB guard (the Kobo inbox takes up to 100 MB, book covers 20 MB, sleep images 10 MB).',
    caveats: ['Edge functions and migrations are deployed manually — a merged change can still be running old code.', 'Ten functions need "Enforce JWT Verification" OFF because they check their own secret.'],
    since: H0, sinceFrom: 'src/integrations/supabase/client.ts', sinceIsHistoryStart: true,
  },
  {
    id: 'github-pages', name: 'GitHub Pages + Actions', provider: 'GitHub', category: 'Platform', official: true,
    docsUrl: 'https://docs.github.com/en/pages',
    moreDocs: [{ label: 'GitHub Actions', url: 'https://docs.github.com/en/actions' }],
    purpose: 'Hosts the built web app and deploys it automatically about a minute after a merge to main.',
    transports: ['cdn'],
    connection: 'A GitHub Actions workflow builds the Vite app with the client build variables and publishes it to Pages; the service worker picks up the new version.',
    auth: 'none', direction: 'read', cadence: 'On every merge to main',
    usedIn: [{ label: 'The whole app', path: '/home' }],
    cost: 'free', caveats: ['Static hosting only — no server rewrites (hence the # router) and no always-on process.'],
    since: H0, sinceFrom: '.github/workflows/deploy.yml', sinceIsHistoryStart: true,
  },

  // ── AI ─────────────────────────────────────────────────────────────────
  {
    id: 'gemini', name: 'Gemini API', provider: 'Google', category: 'AI', official: true,
    docsUrl: 'https://ai.google.dev/gemini-api/docs',
    moreDocs: [{ label: 'Embeddings', url: 'https://ai.google.dev/gemini-api/docs/embeddings' }],
    purpose: 'Answers Ask AI, the shop companion, the PT coach and phone questions; reads photos, extracts recipes and powers semantic search.',
    transports: ['edge'],
    connection: 'Only through the ai-proxy edge function: a tool-calling loop over a curated database catalog, a structured-JSON mode and a server-side page fetch. Falls back across four models.',
    edgeFunctions: ['ai-proxy'], endpoints: ['generativelanguage.googleapis.com'],
    auth: 'api-key', secrets: ['GEMINI_API_KEY', 'PHONE_GATEWAY_SECRET (phone branch)'],
    direction: 'both', cadence: 'On each question — never runs by itself',
    usedIn: [{ label: 'Ask AI (top bar)', path: '/home' }, { label: 'Shop companion', path: '/shop' }, { label: 'PT coach', path: '/training?tab=coach' }, { label: 'AI memory', path: '/developer?tab=memory' }],
    tables: ['ai_memory', 'ai_embeddings', 'ai_usage_log', 'ai_query_log'], migrations: ['064', '065'],
    cost: 'paid', limits: 'A 429 is a real quota error; overload 5xx retries on the next model in the chain.',
    caveats: ['Every model id must be verified live before it enters the chain.', 'Deletes always need your explicit confirmation.'],
    since: H0, sinceFrom: 'supabase/functions/ai-proxy/index.ts', sinceIsHistoryStart: true,
  },

  // ── Productivity ───────────────────────────────────────────────────────
  {
    id: 'google-oauth', name: 'Google OAuth 2.0', provider: 'Google', category: 'Productivity', official: true,
    docsUrl: 'https://developers.google.com/identity/protocols/oauth2',
    purpose: 'One "Connect Google" consent that grants Calendar and Tasks access on a single refresh token.',
    transports: ['browser', 'edge'],
    connection: 'The browser starts the consent; calendar-oauth exchanges the code, calendar-token refreshes the access token and calendar-disconnect revokes it. The token refresh runs app-wide.',
    edgeFunctions: ['calendar-oauth', 'calendar-token', 'calendar-disconnect'], endpoints: ['accounts.google.com', 'oauth2.googleapis.com/token'],
    auth: 'oauth', secrets: ['VITE_GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
    direction: 'both', cadence: 'Once to connect; tokens refresh automatically',
    usedIn: [{ label: 'Subscriptions', path: INTEGRATIONS_PATH }],
    tables: ['user_calendar_tokens'],
    cost: 'free', caveats: ['The consent screen must be in Production — Testing gives a 7-day refresh token.', 'A scope change needs one reconnect.'],
    since: H0, sinceFrom: 'supabase/functions/calendar-oauth/index.ts', sinceIsHistoryStart: true, hasIntegrationCard: true,
  },
  {
    id: 'google-calendar', name: 'Google Calendar API', provider: 'Google', category: 'Productivity', official: true,
    docsUrl: 'https://developers.google.com/calendar/api/v3/reference',
    purpose: 'Shows your calendar events in the day agenda and keeps planned time blocks linked to real calendar events.',
    transports: ['browser'],
    connection: 'Browser direct with the OAuth access token; a time block\'s event is created, moved and deleted with it.',
    endpoints: ['www.googleapis.com/calendar/v3'],
    auth: 'oauth', authNote: 'Scopes calendar.events + calendar.calendarlist.readonly.',
    direction: 'both', cadence: 'On open; the agenda\'s sync button refreshes',
    usedIn: [{ label: 'Daily agenda', path: '/daily' }, { label: 'Home — next up', path: '/home' }],
    tables: ['time_blocks.google_calendar_event_id'], migrations: ['038'],
    cost: 'free',
    caveats: ['A task deleted server-side (AI, triggers) cannot remove its calendar event — no token there.'],
    since: H0, sinceFrom: 'src/features/calendar/api/calendarApi.ts', sinceIsHistoryStart: true, hasIntegrationCard: true,
  },
  {
    id: 'google-tasks', name: 'Google Tasks API', provider: 'Google', category: 'Productivity', official: true,
    docsUrl: 'https://developers.google.com/tasks/reference/rest',
    purpose: 'Mirrors your tasks to Google Tasks so they appear on the phone, and pulls back what you change there.',
    transports: ['browser', 'edge', 'cron'],
    connection: 'Local edits go into an outbox drained by the browser and by google-tasks-sync, which also pulls Google\'s changes back.',
    edgeFunctions: ['google-tasks-sync'], endpoints: ['www.googleapis.com/tasks/v1'],
    auth: 'oauth', secrets: ['GOOGLE_TASKS_SYNC_SECRET (cron)'],
    direction: 'both', cadence: 'On each edit + cron every 20 min',
    usedIn: [{ label: 'Daily — tasks', path: '/daily' }, { label: 'Work board', path: '/work' }, { label: 'Sync buttons', path: INTEGRATIONS_PATH }],
    tables: ['google_tasks_outbox', 'google_tasks_sync_state'], migrations: ['071', '072', '073', '078', '079'],
    cost: 'free',
    caveats: ['A task with a calendar event is kept off Google Tasks so it appears in Google only once.', 'Only the default list; no subtasks or manual order.'],
    since: H0, sinceFrom: 'src/features/todo/api/googleTasksApi.ts', sinceIsHistoryStart: true, hasIntegrationCard: true,
  },

  // ── Health ─────────────────────────────────────────────────────────────
  {
    id: 'health-auto-export', name: 'Apple Health (Health Auto Export)', provider: 'HealthyApps', category: 'Health', official: true,
    docsUrl: 'https://www.healthyapps.dev/',
    moreDocs: [{ label: 'Apple HealthKit', url: 'https://developer.apple.com/documentation/healthkit' }],
    purpose: 'Brings Apple Health metrics and workouts (sleep, steps, heart, weight, scale data) into the Health page.',
    transports: ['webhook-in'],
    connection: 'The Health Auto Export iPhone app reads HealthKit and POSTs to health-export-webhook, which stores every point as its own row.',
    edgeFunctions: ['health-export-webhook'],
    auth: 'device-secret', authNote: 'Authorization: Bearer <secret> — the only model the app supports.',
    secrets: ['HEALTH_EXPORT_WEBHOOK_SECRET', 'HEVY_USER_ID'],
    direction: 'write', cadence: 'Webhook: since-last-sync + a weekly re-export + a sleep catch-up every 2 h',
    usedIn: [{ label: 'Health', path: '/health' }, { label: 'Sleep', path: '/health?section=sleep' }, { label: 'Training — Next', path: '/training?tab=next' }, { label: 'Daily glance', path: '/daily' }],
    tables: ['health_metrics', 'health_workouts'], migrations: ['041'],
    cost: 'paid', limits: 'HealthKit is unreadable while the phone is locked; delivery is best-effort.',
    caveats: ['Needs Export Version 2, Summarize ON, Time Grouping Hours.', 'Re-exports repeat hours; totals collapse them per hour.'],
    since: H0, sinceFrom: 'supabase/functions/health-export-webhook/index.ts', sinceIsHistoryStart: true, hasIntegrationCard: true,
  },

  // ── Training ───────────────────────────────────────────────────────────
  {
    id: 'hevy', name: 'Hevy API', provider: 'Hevy', category: 'Training', official: true,
    docsUrl: 'https://api.hevyapp.com/docs/',
    purpose: 'Workouts, routines, exercise templates and body measurements — the source of truth for strength training.',
    transports: ['edge', 'webhook-in'],
    connection: 'Hevy calls hevy-sync on a new workout; Sync runs the events-based incremental sync; hevy-api writes routines, workouts and measurements back.',
    edgeFunctions: ['hevy-sync', 'hevy-initial-sync', 'hevy-incremental-sync', 'hevy-api'], endpoints: ['api.hevyapp.com/v1'],
    auth: 'api-key', secrets: ['HEVY_API_KEY', 'HEVY_WEBHOOK_SECRET', 'HEVY_USER_ID'],
    direction: 'both', cadence: 'Webhook on each workout + manual Sync',
    usedIn: [{ label: 'Training — Log', path: '/training?tab=log' }, { label: 'Routines', path: '/training?tab=library' }, { label: 'Progress', path: '/training?tab=progress' }, { label: 'Health — Body', path: '/health?section=body' }],
    tables: ['hevy_workouts', 'hevy_routines', 'hevy_sets', 'hevy_body_measurements'],
    cost: 'paid', limits: 'Needs Hevy Pro for API access.',
    caveats: ['Strict payloads: no null fields, no folder_id on update.', 'The upsert logic is copied into all four functions — change them together.'],
    since: H0, sinceFrom: 'supabase/functions/hevy-sync/index.ts', sinceIsHistoryStart: true, hasIntegrationCard: true,
  },
  {
    id: 'strava', name: 'Strava API', provider: 'Strava', category: 'Training', official: true,
    docsUrl: 'https://developers.strava.com/docs/reference/',
    purpose: 'Runs, rides and walks shown next to strength training.',
    transports: ['browser', 'edge'],
    connection: 'OAuth starts in the browser; strava-auth exchanges the code, strava-activities fetches, strava-disconnect deauthorizes.',
    edgeFunctions: ['strava-auth', 'strava-activities', 'strava-disconnect'], endpoints: ['www.strava.com/api/v3'],
    auth: 'oauth', secrets: ['VITE_STRAVA_CLIENT_ID', 'STRAVA_CLIENT_ID', 'STRAVA_CLIENT_SECRET'],
    direction: 'read', cadence: 'Manual sync',
    usedIn: [{ label: 'Training — Log (Strava)', path: '/training?tab=log&view=strava' }],
    tables: ['strava_activities'],
    cost: 'free', limits: 'Rate limited per 15 minutes and per day.',
    since: H0, sinceFrom: 'supabase/functions/strava-auth/index.ts', sinceIsHistoryStart: true, hasIntegrationCard: true,
  },
  {
    id: 'exercise-gifs', name: 'ExerciseGymGifsDB (jsDelivr)', provider: 'JahelCuadrado · jsDelivr', category: 'Training', official: false,
    docsUrl: 'https://github.com/JahelCuadrado/ExerciseGymGifsDB',
    moreDocs: [{ label: 'jsDelivr', url: 'https://www.jsdelivr.com/documentation' }],
    purpose: 'Animated exercise demos, since Hevy returns no exercise media.',
    transports: ['cdn'],
    connection: 'The manifest is fetched once per session and GIFs load lazily from the public CDN, matched to exercise names (or your manual override).',
    endpoints: ['cdn.jsdelivr.net/gh/JahelCuadrado/ExerciseGymGifsDB@v1.1.0'],
    auth: 'none', direction: 'read', cadence: 'Once per session',
    usedIn: [{ label: 'Exercises', path: '/training?tab=library&view=exercises' }, { label: 'Next session', path: '/training?tab=next' }],
    tables: ['exercise_gif_overrides'], migrations: ['082'],
    cost: 'free', caveats: ['Fuzzy name matching can pick the wrong GIF — fix it with ✎ Fix GIF.'],
    since: H0, sinceFrom: 'src/features/training/exerciseMedia.tsx', sinceIsHistoryStart: true,
  },

  // ── Food ───────────────────────────────────────────────────────────────
  {
    id: 'open-food-facts', name: 'Open Food Facts', provider: 'Open Food Facts', category: 'Food', official: true,
    docsUrl: 'https://openfoodfacts.github.io/openfoodfacts-server/api/',
    purpose: 'Barcode and name lookups for packaged foods, reviewed before they are saved per 100 g.',
    transports: ['browser'],
    connection: 'Browser direct (CORS-open, no key); also the fallback when Kassalapp has nothing.',
    endpoints: ['world.openfoodfacts.org/api/v2'],
    auth: 'none', direction: 'read', cadence: 'On each search or scan',
    usedIn: [{ label: 'Log food', path: '/recipes' }, { label: 'Ingredients', path: '/recipes' }],
    tables: ['recipe_ingredient_library'],
    cost: 'free', caveats: ['Search can return 503 when busy — the app says so and retries.'],
    since: H0, sinceFrom: 'src/features/recipes/api/openFoodFactsApi.ts', sinceIsHistoryStart: true,
  },
  {
    id: 'kassalapp', name: 'Kassalapp', provider: 'kassal.app', category: 'Food', official: true,
    docsUrl: 'https://kassal.app/api',
    purpose: 'Norwegian branded groceries with price and nutrition, listed first in online food search.',
    transports: ['edge'],
    connection: 'Through the food-search edge function so the personal key stays server-side.',
    edgeFunctions: ['food-search'], endpoints: ['kassal.app/api/v1'],
    auth: 'api-key', secrets: ['KASSALAPP_API_KEY'],
    direction: 'read', cadence: 'On each search or scan',
    usedIn: [{ label: 'Log food — online search', path: '/recipes' }],
    cost: 'personal-key',
    caveats: ['Nutrition label values and the per-100 g basis are not yet confirmed against a live sample.'],
    since: H0, sinceFrom: 'supabase/functions/food-search/index.ts', sinceIsHistoryStart: true,
  },
  {
    id: 'barcode', name: 'Barcode Detection API + ZXing', provider: 'Browser · ZXing', category: 'Food', official: true,
    docsUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/Barcode_Detection_API',
    moreDocs: [{ label: 'ZXing browser', url: 'https://github.com/zxing-js/browser' }],
    purpose: 'Reads a product barcode with the camera before looking it up.',
    transports: ['browser'],
    connection: 'The native BarcodeDetector where available, else the dynamically loaded ZXing library (iOS). Runs on the device.',
    auth: 'none', direction: 'read', cadence: 'When you scan',
    usedIn: [{ label: 'Log food — scan', path: '/recipes' }],
    cost: 'free', caveats: ['Camera permission is asked per site; manual entry always works.'],
    since: H0, sinceFrom: 'src/features/recipes/components/BarcodeScanner.tsx', sinceIsHistoryStart: true,
  },

  // ── Media ──────────────────────────────────────────────────────────────
  {
    id: 'tmdb', name: 'TMDB', provider: 'The Movie Database', category: 'Media', official: true,
    docsUrl: 'https://developer.themoviedb.org/docs',
    purpose: 'Movie and TV search, discovery, seasons, episodes and artwork.',
    transports: ['browser', 'cdn'],
    connection: 'Browser direct with a client-safe key; images from TMDB\'s image CDN.',
    endpoints: ['api.themoviedb.org/3', 'image.tmdb.org/t/p'],
    auth: 'api-key', secrets: ['VITE_TMDB_API_KEY (client-safe)'],
    direction: 'read', cadence: 'On open; discovery lists refresh manually (24 h)',
    usedIn: [{ label: 'Media', path: '/media' }, { label: 'Daily — watch next', path: '/daily' }],
    tables: ['movies', 'tv_series', 'user_movie_entries', 'user_tv_entries', 'user_tv_episodes'],
    cost: 'free', caveats: ['Attribution to TMDB is required by its terms.'],
    since: H0, sinceFrom: 'src/integrations/tmdb/client.ts', sinceIsHistoryStart: true,
  },
  {
    id: 'trakt', name: 'Trakt', provider: 'Trakt.tv', category: 'Media', official: true,
    docsUrl: 'https://trakt.docs.apiary.io/',
    purpose: 'Watch history with play counts, ratings, watchlist, favorites, dropped shows, paused progress and your episode calendar.',
    transports: ['edge'],
    connection: 'Through trakt-api: OAuth code flow, tokens stored server-side in trakt_tokens (the client secret never reaches the browser).',
    edgeFunctions: ['trakt-api'], endpoints: ['api.trakt.tv', 'trakt.tv/oauth/authorize'],
    auth: 'oauth', secrets: ['TRAKT_CLIENT_ID', 'TRAKT_CLIENT_SECRET', 'TRAKT_SYNC_SECRET', 'TMDB_API_KEY'],
    direction: 'both', cadence: 'Every 30 min (cron), 4 s after a media change, and Sync now',
    usedIn: [{ label: 'Settings → Subscriptions', path: '/settings?tab=subscriptions' }, { label: 'Media → Lists, Continue watching, Coming soon', path: '/media' }],
    tables: ['trakt_tokens', 'trakt_sync_state', 'trakt_unmatched', 'trakt_outbox', 'movies', 'tv_series', 'user_movie_entries', 'user_tv_entries', 'user_tv_episodes'],
    migrations: ['116', '117', '118'],
    cost: 'paid', limits: 'Reads 1,000 per 5 minutes; writes 1 per second. Access tokens last 24 h and refresh automatically.',
    caveats: ['A free account has a small list / item / notes allowance (Trakt answers 420 over it).', 'Notes are not synced yet.', 'Titles without a TMDB id are listed as unmatched, never guessed.'],
    since: '30.09.2026', sinceFrom: 'supabase/functions/trakt-api/index.ts', hasIntegrationCard: true,
  },
  {
    id: 'mdblist', name: 'MDBList', provider: 'MDBList', category: 'Media', official: true,
    docsUrl: 'https://mdblist.docs.apiary.io/',
    purpose: 'Rotten Tomatoes (critics + audience), Metacritic, IMDb and Letterboxd scores, looked up by TMDB id.',
    transports: ['edge'],
    connection: 'Through trakt-api: the `ratings` action (one title, when its page opens) and a weekly refresh of library titles inside the Trakt sync.',
    edgeFunctions: ['trakt-api'], endpoints: ['api.mdblist.com'],
    auth: 'api-key', secrets: ['MDBLIST_API_KEY'],
    direction: 'read', cadence: 'Library titles at most weekly (≤ 200 per type per run); an opened title when its stored scores are older than a week',
    usedIn: [{ label: 'Media → title page, Library (Rotten Tomatoes sort)', path: '/media' }],
    tables: ['movies', 'tv_series'], migrations: ['116', '118'],
    caveats: ['The audience-score source name is not in the blueprint; both `popcorn` and `tomatoesaudience` are read.', 'The free daily limit is not published; a 429 stops the refresh until tomorrow.'],
    cost: 'free-tier',
    since: '30.09.2026', sinceFrom: 'supabase/functions/trakt-api/index.ts',
  },

  // ── Games ──────────────────────────────────────────────────────────────
  {
    id: 'steam-web', name: 'Steam Web API', provider: 'Valve', category: 'Games', official: true,
    docsUrl: 'https://developer.valvesoftware.com/wiki/Steam_Web_API',
    moreDocs: [{ label: 'Get an API key', url: 'https://steamcommunity.com/dev/apikey' }],
    purpose: 'Your owned games, playtime, achievements, level and what you are playing now.',
    transports: ['edge'],
    connection: 'Through steam-api (Steam sends no CORS headers). No OAuth — a personal key and your SteamID64.',
    edgeFunctions: ['steam-api'], endpoints: ['api.steampowered.com'],
    auth: 'api-key', secrets: ['STEAM_API_KEY', 'STEAM_ID64'],
    direction: 'read', cadence: 'On open (library + profile); details when a game opens; shelf Sync',
    usedIn: [{ label: 'Games library', path: '/games' }, { label: 'Advanced → Steam', path: '/games?section=advanced' }],
    tables: ['games'],
    cost: 'personal-key', caveats: ['No wishlist endpoint — deliberately not built.'],
    since: '15.09.2026', sinceFrom: 'supabase/functions/steam-api/index.ts', hasIntegrationCard: true,
  },
  {
    id: 'steam-store', name: 'Steam Store (appdetails)', provider: 'Valve', category: 'Games', official: false,
    docsUrl: 'https://wiki.teamfortress.com/wiki/User:RJackson/StorefrontAPI',
    purpose: 'Store metadata, genres, Metacritic, screenshots and review scores for Steam games.',
    transports: ['edge', 'cdn'],
    connection: 'steam-api fetches store pages and caches them in a shared table; capsule art comes from Steam\'s CDN.',
    edgeFunctions: ['steam-api'], endpoints: ['store.steampowered.com/api', 'cdn.akamai.steamstatic.com'],
    auth: 'none', direction: 'read', cadence: 'Cached: details 14 days, reviews 24 h',
    usedIn: [{ label: 'Games — Steam game', path: '/games' }],
    tables: ['steam_apps'], migrations: ['092'],
    cost: 'free', limits: 'About 200 requests per 5 minutes per IP — at most 20 live fetches per call.',
    caveats: ['Undocumented by Valve; a delisted game is cached as empty.'],
    since: '15.09.2026', sinceFrom: 'supabase/migrations/092_steam_apps.sql',
  },
  {
    id: 'psn', name: 'PlayStation Network (psn-api)', provider: 'Sony · community', category: 'Games', official: false,
    docsUrl: 'https://psn-api.achievements.app/',
    purpose: 'PlayStation playtime library, trophies and PS Plus provenance.',
    transports: ['edge'],
    connection: 'psn-api uses the community psn-api package: you paste an npsso cookie once, the function exchanges and refreshes tokens.',
    edgeFunctions: ['psn-api'],
    auth: 'cookie-token', authNote: 'npsso from a real browser login.',
    direction: 'read', cadence: 'On open; shelf Sync; trophies when a game opens',
    usedIn: [{ label: 'Games library', path: '/games' }, { label: 'Advanced → PlayStation', path: '/games?section=advanced' }],
    tables: ['psn_tokens', 'games'], migrations: ['091', '101'],
    cost: 'free',
    caveats: ['Sony has no public API — best-effort only.', 'Renew the npsso about every 2 months (Sony added a reCAPTCHA).', 'The purchased-games call breaks alone when Sony rotates a query hash.'],
    since: '15.09.2026', sinceFrom: 'supabase/functions/psn-api/index.ts', hasIntegrationCard: true,
  },
  {
    id: 'kobo', name: 'Kobo (KOReader)', provider: 'KOReader on a Kobo Clara BW', category: 'Device', official: true,
    docsUrl: 'https://specs.opds.io/opds-1.2',
    moreDocs: [{ label: 'KOReader OPDS', url: 'https://koreader.rocks/user_guide/#L1-opdscatalog' }, { label: 'Plan', url: 'https://github.com/Lasciviens/Project_Daily/blob/main/docs/kobo/PLAN.md' }],
    purpose: 'The Books page: reading time, progress and the library come from KOReader on the Kobo (our Lasci\'s Board plugin), and books sent from the app download to the Kobo by themselves.',
    transports: ['browser', 'edge', 'device', 'cron'],
    connection: 'The plugin (scripts/kobo/lascisboard.koplugin) posts KOReader statistics rows from a cursor plus the library (Nickel\'s database read-only, sidecars, statistics) to kobo-sync /sync whenever Wi-Fi comes on, and downloads the inbox (/inbox → 10-minute signed URLs → /deliveries/<id>/ack). The browser uploads to the private kobo-inbox bucket; an OPDS 1.2 feed is the fallback. A daily cron deletes files 24 h after download or 7 days unfetched. book-meta fills covers and pages from Nasjonalbiblioteket and Open Library.',
    edgeFunctions: ['kobo-sync', 'book-meta'], endpoints: ['/functions/v1/kobo-sync/sync', '/functions/v1/kobo-sync/inbox', '/functions/v1/kobo-sync/opds/<token>/'],
    auth: 'device-secret', authNote: 'The plugin sends x-kobo-secret (KOBO_SYNC_SECRET, stored in the plugin settings over SSH); the OPDS fallback uses a separate token in its path (KOBO_OPDS_TOKEN), which the cron also sends as x-kobo-token.',
    secrets: ['KOBO_SYNC_SECRET', 'KOBO_OPDS_TOKEN'],
    direction: 'both', cadence: 'Whenever the Kobo\'s Wi-Fi comes on (at most every 10 minutes) and when a book is closed while online; cleanup daily at 03:23 UTC',
    usedIn: [{ label: 'Books', path: '/books' }],
    tables: ['books', 'reading_page_events', 'reading_settings', 'book_deliveries', 'kobo_feed_state'], migrations: ['125', '126'],
    cost: 'free', limits: 'Supabase Free plan: ≤ 50 MB per file, ≤ 100 MB waiting in the inbox (with game media capped at 850 MB, covers 20 MB and sleep images 10 MB, the project stays under 1 GB).',
    caveats: ['Files are only held until the Kobo downloads them — the Kobo is the library, not Supabase.', 'Sync is late, never missing: a day the Kobo has not reported shows as unknown, not zero.', 'Only reading in KOReader is tracked; Nickel (the stock reader) is read for the library list only.'],
    since: '04.10.2026', sinceFrom: 'supabase/functions/kobo-sync/index.ts', hasIntegrationCard: true,
  },
  {
    id: 'igdb', name: 'IGDB', provider: 'Twitch (Amazon)', category: 'Games', official: true,
    docsUrl: 'https://api-docs.igdb.com/',
    moreDocs: [{ label: 'Make the Twitch app', url: 'https://dev.twitch.tv/console' }],
    purpose: 'How long each game takes (to finish, with extras, 100 %), member and critic scores, themes, modes, franchise, similar games and a link to its IGDB page — for retro, Steam and PlayStation games.',
    transports: ['edge', 'cdn'],
    connection: 'igdb-api exchanges a Twitch app\'s Client ID + Secret for an app token (client credentials) and calls IGDB (no CORS). Steam games match by app id; the rest by title, platform and year — exact matches save by themselves, the rest wait for a tick on Games → IGDB. Cover thumbnails come from images.igdb.com.',
    edgeFunctions: ['igdb-api'], endpoints: ['api.igdb.com/v4', 'id.twitch.tv/oauth2/token', 'images.igdb.com'],
    auth: 'api-key', authNote: 'Twitch app Client ID + Client Secret; the server gets and renews its own token.',
    secrets: ['IGDB_CLIENT_ID', 'IGDB_CLIENT_SECRET'],
    direction: 'read', cadence: 'When you press Match (25 games per request); Refresh scores and lengths on demand',
    usedIn: [{ label: 'Games → IGDB', path: '/games?section=igdb' }, { label: 'Games — game detail', path: '/games' }],
    tables: ['games'], migrations: ['121'],
    cost: 'free', limits: '4 requests per second, 8 open at once, 500 rows per query, 10 queries per multiquery.',
    caveats: ['Lengths and member scores are submitted by IGDB members — thin for obscure games.', 'Never overwrites a title, cover or description; only its own columns.'],
    since: '01.10.2026', sinceFrom: 'supabase/functions/igdb-api/index.ts',
  },
  {
    id: 'screenscraper', name: 'ScreenScraper', provider: 'screenscraper.fr', category: 'Games', official: true,
    docsUrl: 'https://www.screenscraper.fr/webapi2.php',
    purpose: 'Retro game metadata, box art, screenshots, manuals and videos, matched by name or ROM hash.',
    transports: ['edge'],
    connection: 'screenscraper-sync searches and saves (owner only); screenscraper-media streams "online" media through signed links so no credential reaches the browser.',
    edgeFunctions: ['screenscraper-sync', 'screenscraper-media'], endpoints: ['api.screenscraper.fr/api2'],
    auth: 'api-key', authNote: 'Developer pair + member pair; media links are HMAC-signed.',
    secrets: ['SCREENSCRAPER_DEVID', 'SCREENSCRAPER_DEVPASSWORD', 'SCREENSCRAPER_SSID', 'SCREENSCRAPER_SSPASSWORD', 'SCREENSCRAPER_MEDIA_KEY (optional)'],
    direction: 'read', cadence: 'Manual — one game or a batch of 10',
    usedIn: [{ label: 'Games — Scrape', path: '/games?section=scrape' }],
    tables: ['screenscraper_systems', 'screenscraper_prefs', 'game_scrape_records', 'scrape_decisions'], migrations: ['094', '099', '104', '108', '109'],
    cost: 'paid', limits: 'Daily request and miss counters are account-wide; the app stops at 300 requests / 50 misses left. Copies stop at the storage budget (≤ 850 MB).',
    caveats: ['Media is CC BY-NC-SA — credit ScreenScraper.fr.', 'Their URLs carry credentials, so none is ever stored or shown.'],
    since: '16.09.2026', sinceFrom: 'supabase/functions/screenscraper-sync/index.ts',
  },
  {
    id: 'esde', name: 'ES-DE device sync (RP6)', provider: 'EmulationStation-DE · Retroid Pocket 6', category: 'Games', official: false,
    docsUrl: 'https://gitlab.com/es-de/emulationstation-de/-/blob/master/USERGUIDE.md',
    purpose: 'Imports the handheld\'s retro library, play statistics, covers and original images.',
    transports: ['webhook-in', 'device'],
    connection: 'Termux widgets on the RP6 push batches to esde-sync (library + stats), esde-media-sync (covers, deletions) and esde-content-sync (source XML + original images).',
    edgeFunctions: ['esde-sync', 'esde-media-sync', 'esde-content-sync'],
    auth: 'device-secret', secrets: ['ESDE_SYNC_SECRET', 'HEVY_USER_ID'],
    direction: 'write', cadence: 'Manual — run a widget on the handheld',
    usedIn: [{ label: 'Games library', path: '/games' }, { label: 'Data health', path: '/games?section=analytics' }],
    tables: ['games', 'game_platforms'], migrations: ['089', '093', '100'],
    cost: 'free', limits: 'Uploads are refused past 850 MB of game media (413 storage_full).',
    caveats: ['Its own secret, separate from the iPhone\'s — revoking one never revokes the other.', 'Re-pushes only update play stats, never your edits.'],
    since: '15.09.2026', sinceFrom: 'supabase/functions/esde-sync/index.ts',
  },

  // ── Travel ─────────────────────────────────────────────────────────────
  {
    id: 'entur', name: 'EnTur Journey Planner + Geocoder', provider: 'Entur (Ruter data)', category: 'Travel', official: true,
    docsUrl: 'https://developer.entur.org/pages-journeyplanner-journeyplanner',
    moreDocs: [{ label: 'Geocoder', url: 'https://developer.entur.org/pages-geocoder-intro' }],
    purpose: 'Departures, trip planning (incl. via stops), nearby stops and stop search for Norwegian public transport.',
    transports: ['browser', 'edge'],
    connection: 'Browser direct GraphQL + geocoder; ai-proxy calls the same APIs for plan_trip.',
    edgeFunctions: ['ai-proxy'], endpoints: ['api.entur.io/journey-planner/v3/graphql', 'api.entur.io/geocoder/v1'],
    auth: 'none', authNote: 'Identified by an ET-Client-Name header.',
    direction: 'read', cadence: 'On open and on each search',
    usedIn: [{ label: 'Home — transit', path: '/home' }, { label: 'Places', path: '/settings?tab=places' }],
    tables: ['user_transit_stops', 'transit_recent_searches'], migrations: ['049'],
    cost: 'free', caveats: ['New GraphQL fields are verified live by introspection before use.', 'Norway only.'],
    since: H0, sinceFrom: 'src/features/home/api/ruterApi.ts', sinceIsHistoryStart: true,
  },

  // ── Home ───────────────────────────────────────────────────────────────
  {
    id: 'met-norway', name: 'MET Norway Locationforecast', provider: 'Norwegian Meteorological Institute', category: 'Home', official: true,
    docsUrl: 'https://api.met.no/weatherapi/locationforecast/2.0/documentation',
    purpose: 'Current weather, a 12-hour strip and a 5-day forecast for where you are.',
    transports: ['browser'],
    connection: 'Browser direct (compact product), keyed by your location or Oslo.',
    endpoints: ['api.met.no/weatherapi/locationforecast/2.0/compact'],
    auth: 'none', direction: 'read', cadence: 'On open (cached)',
    usedIn: [{ label: 'Home — weather', path: '/home' }, { label: 'Daily brief', path: '/home' }],
    cost: 'free', caveats: ['MET\'s terms ask for an identifying User-Agent and caching.'],
    since: H0, sinceFrom: 'src/features/home/api/weatherApi.ts', sinceIsHistoryStart: true,
  },
  {
    id: 'oxr', name: 'Open Exchange Rates', provider: 'Open Exchange Rates', category: 'Home', official: true,
    docsUrl: 'https://docs.openexchangerates.org/',
    purpose: 'NOK ⇄ TRY, EUR ⇄ USD and gold prices with day change.',
    transports: ['browser'],
    connection: 'Browser direct with the app id baked into the build.',
    endpoints: ['openexchangerates.org/api'],
    auth: 'api-key', secrets: ['VITE_OXR_APP_ID'],
    direction: 'read', cadence: 'On open, at most hourly',
    usedIn: [{ label: 'Home — currency', path: '/home' }],
    cost: 'free-tier', limits: 'Monthly request quota depends on the plan.',
    since: H0, sinceFrom: 'src/features/home/api/currencyApi.ts', sinceIsHistoryStart: true,
  },
  {
    id: 'news-rss', name: 'News RSS feeds', provider: 'BBC · VG · CNN Türk', category: 'Home', official: true,
    docsUrl: 'https://www.rssboard.org/rss-specification',
    purpose: 'Headlines on Home.',
    transports: ['edge'],
    connection: 'news-proxy fetches the feeds (and proxies feed images from trusted CDNs) because the browser can\'t read them under CORS.',
    edgeFunctions: ['news-proxy'], endpoints: ['feeds.bbci.co.uk', 'www.vg.no/rss', 'www.cnnturk.com/feed'],
    auth: 'none', direction: 'read', cadence: 'On open',
    usedIn: [{ label: 'Home — news', path: '/home' }],
    cost: 'free',
    since: H0, sinceFrom: 'supabase/functions/news-proxy/index.ts', sinceIsHistoryStart: true,
  },

  // ── Device ─────────────────────────────────────────────────────────────
  {
    id: 'phone-gateway', name: 'iPhone gateway (Shortcuts · Scriptable)', provider: 'Apple Shortcuts · Scriptable', category: 'Device', official: true,
    docsUrl: 'https://support.apple.com/guide/shortcuts/welcome/ios',
    moreDocs: [{ label: 'Scriptable', url: 'https://docs.scriptable.app/' }],
    purpose: 'Log food, water and supplements, read today\'s tasks and nutrition, ask the AI and import scale reports from the phone.',
    transports: ['device', 'edge'],
    connection: 'Shortcuts and Scriptable widgets POST a flat { action } body to phone-gateway; AI actions forward to ai-proxy.',
    edgeFunctions: ['phone-gateway', 'ai-proxy'],
    auth: 'device-secret', secrets: ['PHONE_GATEWAY_SECRET', 'HEVY_USER_ID'],
    direction: 'both', cadence: 'When a Shortcut or widget runs',
    usedIn: [{ label: 'Food diary', path: '/recipes' }, { label: 'Health — Body', path: '/health?section=body' }],
    tables: ['food_log_entries', 'water_log_entries', 'body_composition_reports'], migrations: ['085'],
    cost: 'free', limits: 'Shortcuts time out at about 25 s, so AI answers are single-shot.',
    caveats: ['Widgets refresh about 40–70 times a day, as iOS decides.'],
    since: H0, sinceFrom: 'supabase/functions/phone-gateway/index.ts', sinceIsHistoryStart: true,
  },
  {
    id: 'web-push', name: 'Web Push (VAPID)', provider: 'Browser push services', category: 'Device', official: true,
    docsUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/Push_API',
    moreDocs: [{ label: 'VAPID (RFC 8292)', url: 'https://datatracker.ietf.org/doc/html/rfc8292' }],
    purpose: 'The morning brief on the lock screen while the app is closed.',
    transports: ['cron', 'edge'],
    connection: 'The browser subscribes; pg_cron calls push-send, which signs a push to every saved subscription.',
    edgeFunctions: ['push-send'],
    auth: 'api-key', authNote: 'VAPID key pair; the cron authenticates with its own secret.',
    secrets: ['VITE_VAPID_PUBLIC_KEY', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT', 'PUSH_CRON_SECRET'],
    direction: 'write', cadence: 'Cron daily 07:00 UTC',
    usedIn: [{ label: 'Notifications toggle', path: '/settings?tab=appearance' }],
    tables: ['push_subscriptions'], migrations: ['068'],
    cost: 'free', caveats: ['iOS: only the installed home-screen app, iOS 16.4+, and every push must show a notification.', 'Delivery is best-effort.'],
    since: '23.07.2026', sinceFrom: 'supabase/functions/push-send/index.ts',
  },
  {
    id: 'geolocation', name: 'Geolocation API', provider: 'Browser', category: 'Device', official: true,
    docsUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/Geolocation_API',
    purpose: 'A local weather forecast and nearby transit stops.',
    transports: ['browser'],
    connection: 'Asked once per session on Home; falls back to Oslo when denied.',
    auth: 'none', direction: 'read', cadence: 'Once per session',
    usedIn: [{ label: 'Home', path: '/home' }],
    cost: 'free', caveats: ['The Oslo fallback is not a real fix — nearby stops only use a real one.'],
    since: H0, sinceFrom: 'src/features/home/hooks/useGeolocation.ts', sinceIsHistoryStart: true,
  },
  {
    id: 'web-speech', name: 'Web Speech API', provider: 'Browser', category: 'Device', official: true,
    docsUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API',
    purpose: 'Dictation and hands-free voice chat with Ask AI (Turkish or English).',
    transports: ['browser'],
    connection: 'Speech recognition and speech synthesis built into the browser — no key, no server.',
    auth: 'none', direction: 'both', cadence: 'While voice mode is on',
    usedIn: [{ label: 'Ask AI', path: '/home' }],
    cost: 'free', caveats: ['Unreliable inside an installed iOS app — use the AI\'a Sor Shortcut there.'],
    since: '26.07.2026', sinceFrom: 'src/features/ai/hooks/useVoiceChat.ts',
  },
]

// ── Pure helpers ─────────────────────────────────────────────────────────

/** Case- and accent-insensitive search over the fields a person would type. */
export function matchesQuery(e: ApiEntry, query: string): boolean {
  const q = fold(query.trim())
  if (!q) return true
  const hay = fold([
    e.name, e.provider, e.category, e.purpose, e.connection,
    ...(e.edgeFunctions ?? []), ...(e.secrets ?? []), ...(e.tables ?? []),
    ...e.usedIn.map(u => u.label),
  ].join(' '))
  return q.split(/\s+/).every(w => hay.includes(w))
}

export function filterApis(list: readonly ApiEntry[], categories: readonly ApiCategory[], query: string): ApiEntry[] {
  return list.filter(e => (categories.length === 0 || categories.includes(e.category)) && matchesQuery(e, query))
}

/** Categories that actually have entries, in API_CATEGORIES order, with counts. */
export function categoryCounts(list: readonly ApiEntry[]): { category: ApiCategory; count: number }[] {
  return API_CATEGORIES
    .map(category => ({ category, count: list.filter(e => e.category === category).length }))
    .filter(c => c.count > 0)
}

function fold(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}
