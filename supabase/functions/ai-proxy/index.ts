import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ALLOWED_ORIGINS = ['https://lasciviens.github.io', 'http://localhost:5173']

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  return {
    'Access-Control-Allow-Origin':  allowed,
    'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}

interface Message { role: 'user' | 'assistant'; content: string; images?: string[] }

// Turn a client Message into Gemini `parts`, attaching any images as inline_data
// (base64 data URLs only). Flash-tier models are multimodal, so a photo of a
// meal / food label rides alongside the text and the tool loop still runs.
function parseImageData(s: unknown): { mime_type: string; data: string } | null {
  if (typeof s !== 'string') return null
  const m = /^data:([\w/+.\-]+);base64,(.+)$/s.exec(s.trim())
  return m ? { mime_type: m[1], data: m[2] } : null
}
function partsForMessage(m: Message): AnyRecord[] {
  const parts: AnyRecord[] = []
  if (m.content) parts.push({ text: m.content })
  for (const img of m.images ?? []) { const d = parseImageData(img); if (d) parts.push({ inline_data: d }) }
  if (!parts.length) parts.push({ text: '' })
  return parts
}
function messagesToContents(messages: Message[]): AnyRecord[] {
  return messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: partsForMessage(m) }))
}

// deno-lint-ignore no-explicit-any
type AnyRecord = Record<string, any>

// True for a dotted-quad that lands in a loopback/private/link-local range.
// 169.254.0.0/16 covers cloud metadata (169.254.169.254) too. A malformed
// dotted-numeric string is treated as suspicious (blocked) rather than allowed.
function isPrivateIPv4(ip: string): boolean {
  const p = ip.split('.').map(Number)
  if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true
  const [a, b] = p
  if (a === 0 || a === 127 || a === 10) return true
  if (a === 192 && b === 168) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 169 && b === 254) return true
  return false
}

// Blocks SSRF targets (localhost/loopback/link-local/private ranges) — this
// fetches whatever URL the user pastes, server-side. Beyond the obvious
// dotted-quad ranges this also blocks the encodings that trivially bypass a
// naive string check: numeric-encoded IPv4 (decimal 2130706433, 0x-hex, octal),
// and IPv6 loopback/mapped/unique-local/link-local forms. (DNS rebinding — a
// public name that re-resolves to a private IP at connect time — can't be fully
// closed here without a custom resolver; fetchPageText's manual redirect
// re-validation closes the redirect-based variant, which is the practical one.)
function isPrivateHost(hostname: string): boolean {
  let h = hostname.toLowerCase().trim()
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1)   // [::1] -> ::1

  if (h === 'localhost' || h.endsWith('.localhost')) return true

  // IPv6
  if (h.includes(':')) {
    if (h === '::1' || h === '::') return true
    const mapped = h.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/)  // IPv4-mapped
    if (mapped) return isPrivateIPv4(mapped[1])
    if (/^f[cd]/.test(h)) return true      // fc00::/7 unique-local
    if (/^fe[89ab]/.test(h)) return true   // fe80::/10 link-local
    return false
  }

  // Dotted-quad IPv4
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return isPrivateIPv4(h)

  // All-numeric or 0x/octal host = decimal/hex/octal-encoded IPv4 (e.g.
  // 2130706433, 0x7f000001, 017700000001) — Deno's fetch resolves these to the
  // encoded IP, skipping the dotted-quad checks above. Block outright.
  if (/^(0x[0-9a-f]+|\d+)$/.test(h)) return true

  return false
}

// Strips scripts/styles/tags and decodes common entities to leave plain
// readable text — good enough for an LLM to extract a recipe from, without
// pulling in a full HTML-parsing dependency.
function extractReadableText(html: string): string {
  let s = html
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ')
  s = s.replace(/<style[\s\S]*?<\/style>/gi, ' ')
  s = s.replace(/<!--[\s\S]*?-->/g, ' ')
  s = s.replace(/<[^>]+>/g, '\n')
  s = s
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
  s = s.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
  return s.slice(0, 15000)
}

async function fetchPageText(rawUrl: string): Promise<string> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)
  try {
    // Follow redirects MANUALLY so every hop's target is re-checked against the
    // SSRF guard. With fetch's default automatic redirect following, a URL on a
    // public host that passes the initial check could 30x-bounce to an internal
    // address (e.g. 169.254.169.254) that never gets re-validated.
    let current = rawUrl
    let res!: Response
    for (let hop = 0; ; hop++) {
      let url: URL
      try { url = new URL(current) } catch { throw new Error('Invalid URL') }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Invalid URL')
      if (isPrivateHost(url.hostname)) throw new Error('URL not allowed')

      res = await fetch(url.toString(), {
        signal:   controller.signal,
        redirect: 'manual',
        headers:  { 'User-Agent': 'Mozilla/5.0 (compatible; LascisBoardRecipeBot/1.0)' },
      })

      const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null
      if (!location) break
      if (hop >= 5) throw new Error('Too many redirects')
      current = new URL(location, url).toString()   // resolve relative redirects
    }

    if (!res.ok) throw new Error(`Failed to fetch URL: ${res.status}`)
    const html = await res.text()
    return extractReadableText(html)
  } finally {
    clearTimeout(timeout)
  }
}

class RateLimitError extends Error {
  constructor(
    public readonly dailyLimit: number,
    public readonly retryAfterSec: number,
  ) {
    super('rate_limit')
    this.name = 'RateLimitError'
  }
}

// Parses Gemini's 429 error body for the quota/retry-delay hints and throws
// RateLimitError — was duplicated identically in callGemini and callGeminiStructured.
function throwRateLimit(errText: string): never {
  let dailyLimit = 20
  let retryAfterSec = 60
  try {
    const errJson = JSON.parse(errText)
    const violations = errJson.error?.details?.find((d: AnyRecord) => d.violations)?.violations ?? []
    if (violations[0]?.quotaValue) dailyLimit = parseInt(violations[0].quotaValue) || 20
    const retryStr = errJson.error?.details?.find((d: AnyRecord) => d.retryDelay)?.retryDelay ?? ''
    if (retryStr) retryAfterSec = parseInt(retryStr) || 60
  } catch { /* ignore */ }
  throw new RateLimitError(dailyLimit, retryAfterSec)
}

// Model fallback chain — real-world Gemini 503 ("high demand") waves hit
// individual models' capacity pools unevenly (verified via research: Google's
// own forum + status trackers show newly-launched/high-traffic tiers overload
// far more than others during the same window), so retrying the SAME model
// repeatedly can spend the whole retry budget inside one overloaded pool.
// Trying a DIFFERENT model is a materially better fallback than trying the
// same one again.
//
// EVERY id here was live-verified against the real API (2026-07-17) — an
// earlier version of this chain included two guessed ids (gemini-3-flash,
// gemini-3.1-pro) that 404'd in production; never add ids without probing
// (use the `listModels` debug branch below with the real key). Verified:
// gemini-3.5-flash (exists; was 503-overloaded at test time),
// gemini-3.1-flash-lite (exists; served a live request). gemini-2.5-flash /
// -lite are Google-documented GA-stable until 2026-10-16 — and even if an id
// here ever dies, a 404 now SKIPS to the next model instead of aborting.
const MODEL_CHAIN = ['gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'] as const
type GeminiModel = typeof MODEL_CHAIN[number]
const DEFAULT_MODEL: GeminiModel = MODEL_CHAIN[0]

// Per-surface starting model — only the PREFERRED start of the fallback chain;
// a 503 still falls through the whole chain. Any other surface (general, coach,
// or an old client still sending the retired 'shop' surface) starts on the
// default. Tunable — see docs/ai-cost-capability-analysis.md §5.
const SURFACE_MODEL: Record<string, GeminiModel> = {
  // Phone (Apple Shortcuts) is latency-critical — iOS "Get Contents of URL"
  // times out at ~25s — so start on a fast lite model, skipping the frequently
  // 503-overloaded 3.5-flash primary (a 503 there burned ~7-13s of retry
  // budget before falling through). A 503 still falls through the rest of the
  // chain. Pairs with the 'phone' tool slice below (no tools → single-shot).
  phone: 'gemini-3.1-flash-lite',
}

function isGeminiModel(m: unknown): m is GeminiModel {
  return typeof m === 'string' && (MODEL_CHAIN as readonly string[]).includes(m)
}

// thinking_config/thinking_level is a Gemini-3.x-only generationConfig field —
// live-verified: sending it to the 2.5-generation tail of the chain (added in
// the earlier 404-fix round) 400s with "Thinking level is not supported for
// this model", which a REAL user hit by explicitly picking 2.5 Flash. The
// request body can no longer be identical across the whole chain (previous
// bug: one fixed body object reused for every model regardless of generation)
// — it must be built PER MODEL now.
function supportsThinking(model: GeminiModel): boolean {
  return model.startsWith('gemini-3')
}

// Per-CHAIN-POSITION retry budget — the user wants the BETTER models tried
// hard before falling to a lighter one ("düşük model zaten her türlü dönüyor"):
// the preferred/first model gets 4 attempts with growing backoff (~7s worth),
// the second 3, the tail models 2 (they're the escape hatch, not the goal).
const RETRIES_BY_POSITION = [4, 3, 2, 2]
const RETRY_BASE_DELAY_MS = 700
// Per-attempt hard ceiling. A single Gemini generation is normally 1-5s; 20s
// bounds a genuinely hung connection (there was NO timeout before — a hang
// blocked forever, and with up to 11 attempts total there was no upper bound).
const GEMINI_ATTEMPT_TIMEOUT_MS = 20_000

// Random spread on the backoff delay ("jitter") — without it, if this
// function is ever invoked concurrently (e.g. two tabs), every retry lands on
// the exact same schedule and re-hammers the just-recovering server at once
// (the "thundering herd" problem); jitter spreads retries out instead.
function jitter(ms: number): number {
  return ms + Math.random() * ms * 0.4
}

// Gemini occasionally returns a transient "model overloaded"/high-demand
// error (5xx) that clears up within seconds if retried — distinct from a 429
// (real daily/per-minute quota exhaustion, which retrying won't fix, so that
// still surfaces immediately via throwRateLimit upstream). Retries each model
// a couple of times with jittered backoff, then moves to the NEXT model in
// the chain rather than continuing to hammer one — so the user only sees a
// failure after every model's capacity pool has genuinely been exhausted,
// not after one pool's transient hiccup (this was a real ~80%-of-requests
// pain point even before the multi-model chain existed).
async function fetchGeminiWithFallback(
  apiKey:          string,
  buildUrl:        (model: GeminiModel) => string,
  buildBody:       (model: GeminiModel) => AnyRecord,
  preferredModel?: GeminiModel,
): Promise<{ res: Response; modelUsed: GeminiModel }> {
  const chain: GeminiModel[] = preferredModel
    ? [preferredModel, ...MODEL_CHAIN.filter(m => m !== preferredModel)]
    : [...MODEL_CHAIN]

  let lastRes: Response | null = null
  let lastModel: GeminiModel = chain[0]
  for (let pos = 0; pos < chain.length; pos++) {
    const model = chain[pos]
    const retries = RETRIES_BY_POSITION[pos] ?? 2
    for (let attempt = 0; attempt < retries; attempt++) {
      const res = await fetch(buildUrl(model), {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(buildBody(model)),
      })
      if (res.ok) return { res, modelUsed: model }
      // 404 = THIS model id doesn't exist (retired/renamed) — skip straight
      // to the next model in the chain. Real production bug this fixes: a
      // 404 mid-chain used to be returned as the final answer, aborting the
      // whole chain even though later models were alive and serving.
      if (res.status === 404) { lastRes = res; lastModel = model; break }
      // 429 (per-KEY quota — switching models won't help) and other 4xx
      // (malformed request — same for every model) surface immediately.
      if (res.status < 500) return { res, modelUsed: model }
      // 5xx: transient overload — retry this model (exponentially growing,
      // jittered waits), then move to the next.
      lastRes = res
      lastModel = model
      if (attempt < retries - 1) {
        await new Promise(r => setTimeout(r, jitter(RETRY_BASE_DELAY_MS * Math.pow(2, attempt))))
      }
    }
  }
  return { res: lastRes!, modelUsed: lastModel }
}

const TOOLS = [
  {
    functionDeclarations: [
      // ─── Generic database access (the primary interface) ──────────────────
      // These 5 tools let the assistant read and write ANY of the user's own
      // data tables. Call describe_database first to learn the schema, then
      // db_query / db_insert / db_update / db_delete. Every operation is
      // automatically scoped to the current user and restricted to an
      // allow-listed set of tables (see DB_CATALOG) — token/secret/auth tables
      // are never reachable, and externally-synced tables (Hevy, Strava) are
      // read-only. filters/values are passed as JSON strings.
      {
        name: 'describe_database',
        description: 'Return the database schema catalog: which tables exist, their purpose, columns, enum values, relationships, and business rules. ALWAYS call this first (once) when you are unsure which table or column to use for a read/write. Pass a table name to get its full detail, or omit for the overview of all tables.',
        parameters: {
          type: 'OBJECT',
          properties: {
            table: { type: 'STRING', description: 'Optional — a single table name to get full column/enum/rule detail for.' },
          },
          required: [],
        },
      },
      {
        name: 'db_query',
        description: 'Read rows from a table. Automatically scoped to the current user. Use describe_database to learn valid tables/columns first.',
        parameters: {
          type: 'OBJECT',
          properties: {
            table:   { type: 'STRING', description: 'Table name (must be in the catalog).' },
            filters: { type: 'STRING', description: 'Optional JSON object of column filters. Plain value = equals; null = IS NULL; array = IN; object with gte/lte/gt/lt/neq/like keys for ranges/patterns. E.g. {"status":"open"} or {"date":{"gte":"2026-07-01","lte":"2026-07-07"}}.' },
            select:  { type: 'STRING', description: 'Optional Postgrest select string. Default "*". Supports embedded joins, e.g. "id, status, movie:movies(title)" or "title, hevy_workout_exercises(title, hevy_sets(weight_kg, reps))".' },
            order_by:  { type: 'STRING', description: 'Optional column to order by.' },
            ascending: { type: 'BOOLEAN', description: 'Order direction (default false = newest/highest first).' },
            limit:     { type: 'NUMBER', description: 'Max rows (default 50, max 200).' },
          },
          required: ['table'],
        },
      },
      {
        name: 'db_insert',
        description: 'Insert row(s) into a writable table. user_id is set automatically; do not include it. Returns the created row(s) with their id(s). For bulk loads (multiple rows), pass an ARRAY in values and insert them all in ONE call — do not call db_insert once per row. Use describe_database to learn required columns, enums, and business rules first.',
        parameters: {
          type: 'OBJECT',
          properties: {
            table:  { type: 'STRING', description: 'Table name (must be writable in the catalog).' },
            values: { type: 'STRING', description: 'JSON for the row(s): a single object {"title":"..."} OR an array of objects [{"title":"a"},{"title":"b"}] to insert many at once.' },
          },
          required: ['table', 'values'],
        },
      },
      {
        name: 'db_update',
        description: 'Update existing rows matching filters in a writable table. Automatically scoped to the current user; updated_at is set automatically when the column exists. Returns the updated row(s). Provide a filter (usually {"id":"..."}) to avoid updating everything.',
        parameters: {
          type: 'OBJECT',
          properties: {
            table:   { type: 'STRING', description: 'Table name (must be writable in the catalog).' },
            filters: { type: 'STRING', description: 'JSON object identifying rows to update, e.g. {"id":"..."}. Required and must be non-empty.' },
            values:  { type: 'STRING', description: 'JSON object of column→new value. user_id cannot be changed.' },
          },
          required: ['table', 'filters', 'values'],
        },
      },
      {
        name: 'db_delete',
        description: 'Delete rows matching filters from a writable table. Automatically scoped to the current user. Filters are required and must be non-empty. Deleting a task automatically deletes its linked time_blocks row too (task_id is ON DELETE CASCADE) — no separate time_blocks delete needed.',
        parameters: {
          type: 'OBJECT',
          properties: {
            table:   { type: 'STRING', description: 'Table name (must be writable in the catalog).' },
            filters: { type: 'STRING', description: 'JSON object identifying rows to delete, e.g. {"id":"..."}. Required and must be non-empty.' },
          },
          required: ['table', 'filters'],
        },
      },
      // ─── Live read-only SQL escape hatch (explicit user opt-in only) ──────
      {
        name: 'run_read_query',
        description: 'LIVE read-only SQL escape hatch. Use ONLY when the user EXPLICITLY asks for a raw / custom / complex query the structured db_query cannot express (multi-table JOIN, GROUP BY / aggregate, arithmetic, window functions), or explicitly says "live sql" / "raw sql" / "canlı sorgu" / "özel sorgu". Constraints (enforced server-side): a SINGLE SELECT (or WITH … SELECT) statement only — no INSERT/UPDATE/DELETE/DDL, no semicolons; only the allow-listed catalog tables may be referenced (call describe_database if unsure of names/columns); results are row-capped and the query is read-only + timed out. Prefer db_query for anything it can already do. Always show the user the SQL you ran.',
        parameters: {
          type: 'OBJECT',
          properties: {
            sql: { type: 'STRING', description: 'A single read-only SELECT (or WITH...SELECT) statement. No trailing semicolon. Reference only allow-listed tables. Rows are auto-scoped to the user and capped.' },
          },
          required: ['sql'],
        },
      },
      // ─── Durable AI memory (user-directed) ────────────────────────────────
      {
        name: 'save_memory',
        description: 'Persist a durable note/summary/fact to the user\'s AI memory (ai_memory table) so it survives across conversations. Use it when the user asks you to remember something for later ("bunu aklında tut", "şunu kaydet", "bunu unutma"), or to store a compacted summary of the current conversation when they ask. Announce what you will save before calling. Recall saved memories later via db_query on ai_memory. Save only FACTS about the user here: something they want to do or a place they want to go goes in wish_items, a request about this app in dev_requests, something to buy in shop_items — use db_insert for those.',
        parameters: {
          type: 'OBJECT',
          properties: {
            title:   { type: 'STRING', description: 'Short label for the memory (a few words).' },
            content: { type: 'STRING', description: 'The full note/summary/fact to remember, in the user\'s language.' },
            kind:    { type: 'STRING', enum: ['note', 'summary', 'fact', 'preference'], description: 'Optional — default "note". Use "summary" for a compacted conversation recap, "preference" for a standing user preference.' },
          },
          required: ['title', 'content'],
        },
      },
      // ─── Aggregation (analytics without dumping rows into context) ─────────
      {
        name: 'db_aggregate',
        description: 'Aggregate a table (sum/avg/min/max/count, optionally grouped) and get back ONLY the computed numbers — never the raw rows. USE THIS for any "average/total/trend/compare/how many/how much over time" question instead of db_query-then-count-in-your-head: it is both cheaper and correct (the math is done in code, not by you). Auto-scoped to the user. E.g. average protein over a date range, total kcal per day, workout count per week.',
        parameters: {
          type: 'OBJECT',
          properties: {
            table:   { type: 'STRING', description: 'Table name (must be in the catalog).' },
            metrics: { type: 'STRING', description: 'JSON array of {op, column?, as?}. op ∈ sum|avg|min|max|count. column is required except for count (count with no column = row count). E.g. [{"op":"avg","column":"protein_g","as":"avg_protein"},{"op":"count"}].' },
            filters: { type: 'STRING', description: 'Optional JSON filter object, SAME grammar as db_query (equals / null / array=IN / {gte,lte,gt,lt,neq,like}). E.g. {"status":"eaten","date":{"gte":"2026-07-01"}}.' },
            group_by:{ type: 'STRING', description: 'Optional JSON array of column names to group by, e.g. ["date"] or ["meal_slot"]. Omit for a single overall aggregate.' },
          },
          required: ['table', 'metrics'],
        },
      },
      {
        name: 'get_day_summary',
        description: 'One compact snapshot of a single day — open tasks, calories + protein eaten, scheduled blocks, whether a workout was logged. Prefer this over several separate db_query calls when the user asks "how is my day / what does today look like".',
        parameters: {
          type: 'OBJECT',
          properties: {
            date: { type: 'STRING', description: 'YYYY-MM-DD. Defaults to today if omitted.' },
          },
          required: [],
        },
      },
      {
        name: 'get_athlete_profile',
        description: 'One compact call returning the user\'s durable training profile (training focus, experience level, training days/week, equipment) AND their active movement-pattern limitations. Their goal (phase, targets, goal weight) is day_targets, not this. Prefer this over two separate db_query calls before giving any training/programming advice — cheaper and the standard first step for training questions.',
        parameters: { type: 'OBJECT', properties: {}, required: [] },
      },
      // ─── Semantic recall over the user's own text ─────────────────────────
      {
        name: 'semantic_search',
        description: "Fuzzy/meaning-based search over the user's OWN text content (recipes, past coach assessments, dev backlog, work notes, saved AI memories) — for recall questions where you don't know the exact words, e.g. \"that Italian recipe I saved\", \"what did the coach tell me about deloads\", \"the note about the width standard\". Returns {source_table, source_id, content, similarity}. Then db_query the live row by that source_id if you need full/fresh fields. Use db_query (not this) when you already know the exact table+filter.",
        parameters: {
          type: 'OBJECT',
          properties: {
            query: { type: 'STRING', description: 'Natural-language description of what to find.' },
            limit: { type: 'NUMBER', description: 'Max matches (default 8, max 25).' },
          },
          required: ['query'],
        },
      },
      // ─── Media (kept — non-trivial multi-step logic) ──────────────────────
      {
        name: 'get_media',
        description: 'The user\'s movie + TV library (kept in sync with Trakt), one compact line per title: entry_id, title, status, and when known rating (1-10, their own), genres, favorite, released / first_aired, watched (movies) or started / finished (TV), plays (when watched more than once), planned, a short note. Dates are yyyy-mm-dd here — write them to the user as DD.MM.YYYY; watched "unknown" = watched on an unknown date (say "date unknown"). coming_soon=true = a want-to-watch title not released yet. TV current_season/current_episode = the highest episode marked watched (episode 0 = none yet). Use entry_id with plan_media, mark_episode_watched or db_update.',
        parameters: {
          type: 'OBJECT',
          properties: {
            type:   { type: 'STRING', enum: ['movie', 'tv', 'both'], description: 'Default: both' },
            status: { type: 'STRING', enum: ['active', 'wishlist', 'watching', 'paused', 'completed', 'dropped', 'all'], description: 'Default: active = watching + paused + want to watch (wishlist). paused is TV only.' },
            limit:  { type: 'NUMBER', description: 'Max titles per type (default 25, max 100). Newest added first; completed titles most recently watched first.' },
          },
          required: [],
        },
      },
      {
        name: 'plan_media',
        description: 'Plan to watch a movie or TV episode — creates a task and adds it to the day schedule.',
        parameters: {
          type: 'OBJECT',
          properties: {
            title:       { type: 'STRING', description: 'Media title' },
            media_type:  { type: 'STRING', enum: ['movie', 'tv'] },
            date:        { type: 'STRING', description: 'YYYY-MM-DD' },
            entry_id:    { type: 'STRING', description: 'user_movie_entries.id or user_tv_entries.id (optional, from get_media)' },
            season:      { type: 'NUMBER', description: 'Season number (TV only, optional)' },
            episode:     { type: 'NUMBER', description: 'Episode number (TV only, optional)' },
          },
          required: ['title', 'media_type', 'date'],
        },
      },
      {
        name: 'get_calendar_events',
        description: 'Read upcoming Google Calendar events. Use to answer "what meetings do I have?" or schedule around events.',
        parameters: {
          type: 'OBJECT',
          properties: {
            days_ahead: { type: 'NUMBER', description: 'How many days ahead to look (default 7, max 30)' },
          },
          required: [],
        },
      },
      {
        name: 'get_health_stats',
        description: 'Read daily health stats (steps, active/basal energy in kcal, heart rate min/avg/max, resting heart rate, exercise minutes, AND SLEEP — per-night hours + deep/core/rem/awake breakdown, last night + period average, overlap-merged and source-resolved) computed from health_metrics, plus period averages. Use to answer any fitness/health/SLEEP question — prefer this over raw db_query for trend/average/sleep questions.',
        parameters: {
          type: 'OBJECT',
          properties: {
            days: { type: 'NUMBER', description: 'How many days back to look (default 7, max 30)' },
          },
          required: [],
        },
      },
      {
        name: 'mark_episode_watched',
        description: 'Mark ONE TV episode as watched now. The show\'s progress (current_season/current_episode) follows by itself, and the change reaches Trakt by itself. An episode already marked watched keeps its real date (a rewatch is repeat_count + 1 on its user_tv_episodes row, via db_update). Use get_media first to get the entry_id.',
        parameters: {
          type: 'OBJECT',
          properties: {
            entry_id: { type: 'STRING', description: 'user_tv_entries.id from get_media' },
            season:   { type: 'NUMBER', description: 'Season number watched (optional — defaults to current)' },
            episode:  { type: 'NUMBER', description: 'Episode number watched (optional — defaults to current+1 in the same season; if the user did not name it and that season may have ended, ask instead of guessing)' },
            rating:   { type: 'NUMBER', description: '1–10 personal rating (optional)' },
            note:     { type: 'STRING', description: 'Personal note about the episode (optional)' },
          },
          required: ['entry_id'],
        },
      },
      {
        name: 'update_hevy_routine',
        description: 'Update an existing Hevy routine (title, the routine\'s own note, and/or full exercises list) — writes to the REAL Hevy account. RULES: (1) db_query hevy_routines + hevy_routine_exercises + hevy_routine_sets FIRST to get the routine id and its CURRENT full exercise/set structure. (2) Send the COMPLETE exercises array (every exercise you want kept, in order) — this REPLACES the whole list, omitted exercises are DELETED. (3) Set shape: {type:"normal"|"warmup"|"dropset"|"failure", weight_kg, reps} — use rep_range:{start,end} INSTEAD of reps only when a range is wanted, never both, never rep_range:null. Exercise shape: {exercise_template_id, superset_id, rest_seconds, notes, sets:[...]} — that per-exercise "notes" is a note on ONE exercise, not the routine. (4) The routine\'s OWN note/description (what shows under the routine title in Hevy) is the separate top-level "notes" param below — omit it to leave the routine\'s existing note untouched, or send the full replacement text (it REPLACES, it does not append). (5) ALWAYS summarize the exact change and get the user\'s explicit confirmation in a prior turn before calling this.',
        parameters: {
          type: 'OBJECT',
          properties: {
            routine_id: { type: 'STRING', description: 'hevy_routines.id (from db_query)' },
            title:      { type: 'STRING', description: 'Routine title (required by Hevy — resend the current one if unchanged)' },
            notes:      { type: 'STRING', description: 'The routine\'s OWN note/description (hevy_routines.notes) — optional, omit to leave it unchanged. This replaces the whole note, it does not append to it.' },
            exercises:  { type: 'STRING', description: 'JSON array of the COMPLETE exercise list in the shape described above.' },
          },
          required: ['routine_id', 'title', 'exercises'],
        },
      },
      {
        name: 'create_hevy_routine',
        description: 'Create a NEW Hevy routine — writes to the REAL Hevy account (Hevy is the source of truth; the local DB copy is synced automatically). RULES: (1) db_query hevy_exercise_templates FIRST to resolve real exercise_template_id values for every exercise (never invent ids; match by title). (2) Exercise shape: {exercise_template_id, superset_id, rest_seconds, notes, sets:[...]} — set shape: {type:"normal"|"warmup"|"dropset"|"failure", weight_kg, reps} — use rep_range:{start,end} INSTEAD of reps only when a range is wanted, never both, never rep_range:null. NO index/rpe/title keys anywhere. (3) folder_id is optional (db_query hevy_routine_folders if the user names a folder). (4) ALWAYS present the full planned routine (title + every exercise with sets/reps/weights) and get the user\'s explicit confirmation in a prior turn before calling this.',
        parameters: {
          type: 'OBJECT',
          properties: {
            title:     { type: 'STRING', description: 'New routine title' },
            notes:     { type: 'STRING', description: 'Routine notes (optional)' },
            folder_id: { type: 'STRING', description: 'hevy_routine_folders.id (optional — omit for no folder)' },
            exercises: { type: 'STRING', description: 'JSON array of the COMPLETE exercise list in the shape described above.' },
          },
          required: ['title', 'exercises'],
        },
      },
      {
        name: 'get_shop_categories',
        description: 'List all shopping categories (top categories and their subcategories). ALWAYS call this before create_shop_category or before create_shop_item on the wishlist, to check for an existing matching subcategory.',
        parameters: { type: 'OBJECT', properties: {}, required: [] },
      },
      {
        name: 'create_shop_category',
        description: 'Create a shopping category. Omit parent_id to create a NEW TOP category; pass parent_id (from get_shop_categories) to create a subcategory under an existing top category. Only ever call this after get_shop_categories found no matching subcategory, and only after the user has confirmed the category name/placement if it was ambiguous.',
        parameters: {
          type: 'OBJECT',
          properties: {
            name:      { type: 'STRING' },
            parent_id: { type: 'STRING', description: 'Top category ID (omit to create a new top category)' },
          },
          required: ['name'],
        },
      },
      {
        name: 'create_shop_item',
        description: 'Add something to BUY to one of the two shopping lists. list="wishlist" (default) = things to buy someday: category_id is REQUIRED — the most specific fitting category ID from get_shop_categories or a just-created create_shop_category result (a subcategory, or a top category when no subcategory fits). list="quick" = the short errand/grocery list ("milk", "batteries", "pick up a charger"): category_id is optional and usually left out. A recipe is never a shop item. Never estimate, look up or invent a price: set price only when the user stated it, with its currency (when they name only a region, the currency follows it: TR → TRY, NO → NOK).',
        parameters: {
          type: 'OBJECT',
          properties: {
            list:         { type: 'STRING', enum: ['wishlist', 'quick'], description: 'Which list (default wishlist)' },
            category_id:  { type: 'STRING', description: 'Category ID (most specific fitting) — required on the wishlist, optional on the quick list' },
            title:        { type: 'STRING' },
            notes:        { type: 'STRING' },
            price:        { type: 'NUMBER', description: 'Only a price the user stated for this item (optional)' },
            currency:     { type: 'STRING', enum: ['NOK', 'TRY', 'EUR', 'USD'], description: 'The price\'s currency (optional — follows region when omitted)' },
            platform:     { type: 'STRING', description: 'Where to buy it: the store ("Rema", "Kiwi" — the quick list groups by it) or a platform for games/apps ("PS5", "iOS") (optional)' },
            url:          { type: 'STRING' },
            priority:     { type: 'STRING', enum: ['low', 'medium', 'high'] },
            region:       { type: 'STRING', enum: ['TR', 'NO'], description: 'Which country this purchase relates to (optional)' },
            planned_date: { type: 'STRING', description: 'YYYY-MM-DD — when the user plans to buy this (optional)' },
          },
          required: ['title'],
        },
      },
      {
        name: 'ask_clarifying_question',
        description: 'Ask the user a clarifying yes/no or multiple-choice question and present the choices as tappable buttons, instead of asking them to type a free-text answer. Use this whenever you need a decision from the user before proceeding (e.g. confirming a new category) — do NOT combine this with other function calls in the same turn; ask first, wait for their tap, then act.',
        parameters: {
          type: 'OBJECT',
          properties: {
            question: { type: 'STRING' },
            options:  { type: 'ARRAY', items: { type: 'STRING' }, description: '2-4 short tappable option labels' },
          },
          required: ['question', 'options'],
        },
      },
      {
        name: 'get_saved_transit',
        description: 'List the user\'s OWN saved transit stops and routes with their labels. You usually do NOT need this — plan_trip and get_next_transit resolve "home"/"ev"/"work"/"iş" and saved names by themselves. Only call it if the user explicitly asks what they have saved, or to help them manage saved stops/routes.',
        parameters: { type: 'OBJECT', properties: {}, required: [] },
      },
      {
        name: 'search_transit_stops',
        description: 'Search for ANY transit stop or address by free text, returning candidates with exact ids. You usually do NOT need this for routing — plan_trip does its own place resolution and, when a place is ambiguous, returns candidates for you to ask about. Use search only when the user asks to save a new stop/route (to get its id first), or when they explicitly want to look a place up.',
        parameters: {
          type: 'OBJECT',
          properties: {
            query: { type: 'STRING', description: 'Place name or address to search for, in Norwegian if possible (e.g. "Sinsen", "Karl Johans gate")' },
          },
          required: ['query'],
        },
      },
      {
        name: 'save_transit_stop',
        description: 'Save a transit stop as a favorite with a label (e.g. "Home", "Work"), so it resolves by that label in plan_trip/get_next_transit afterwards. Get the exact stop_id/stop_name from search_transit_stops or get_saved_transit first — never invent them. Use when the user asks to save/remember a stop.',
        parameters: {
          type: 'OBJECT',
          properties: {
            stop_id:    { type: 'STRING', description: 'Exact NSR:StopPlace:NNNNN id, from search_transit_stops' },
            stop_name:  { type: 'STRING', description: 'The stop\'s real name, from search_transit_stops' },
            label:      { type: 'STRING', description: 'User-facing label, e.g. "Home", "Work" (optional)' },
            is_default: { type: 'BOOLEAN', description: 'Make this the default stop used when no place is specified (optional)' },
          },
          required: ['stop_id', 'stop_name'],
        },
      },
      {
        name: 'save_transit_route',
        description: 'Save a point-to-point route as a labeled preset (e.g. label "Home" = the route to get home), so "home"/"ev" resolves to this exact route in plan_trip afterwards. Get exact stop ids/names from search_transit_stops or get_saved_transit first — never invent them. Use when the user asks to save/remember a route.',
        parameters: {
          type: 'OBJECT',
          properties: {
            label:          { type: 'STRING', description: 'e.g. "Home", "Work"' },
            from_stop_id:   { type: 'STRING' },
            from_stop_name: { type: 'STRING' },
            to_stop_id:     { type: 'STRING' },
            to_stop_name:   { type: 'STRING' },
          },
          required: ['label', 'from_stop_id', 'from_stop_name', 'to_stop_id', 'to_stop_name'],
        },
      },
      {
        name: 'get_next_transit',
        description: 'Get the next departures from a transit stop — either a saved one by name, or ANY stop by its exact id (from search_transit_stops or plan_trip). Use to answer "when is the next bus/tram?"',
        parameters: {
          type: 'OBJECT',
          properties: {
            stop_name: { type: 'STRING', description: 'Partial name of a SAVED stop (optional — uses default stop if both this and stop_id are omitted)' },
            stop_id:   { type: 'STRING', description: 'Exact NSR:StopPlace:NNNNN id — use this for a stop that isn\'t saved (get it from search_transit_stops first). Takes precedence over stop_name if both given.' },
            count:     { type: 'NUMBER', description: 'Number of departures to return (default 5)' },
          },
          required: [],
        },
      },
      {
        name: 'plan_trip',
        description: 'Plan a point-to-point public-transit journey with transfers (e.g. "eve nasıl giderim", "110 sonra 23\'e aktarma var mı", "18:00\'de X\'te olmam gerekiyor"). CALL THIS DIRECTLY IN ONE SHOT for any routing question — do NOT look things up first. It resolves places itself: "home"/"ev"/"work"/"iş" and saved stop/route names match the user\'s saved data; other names hit an address/venue search; an exact "NSR:StopPlace:NNNNN" id is used as-is. Just pass the user\'s own words as from/to. If a place can\'t be resolved it returns success:false with needs_clarification:true and a candidates list — then (and only then) ask the user with ask_clarifying_question using those candidates. Report only stops/lines/times present in the result; never invent them.',
        parameters: {
          type: 'OBJECT',
          properties: {
            from:       { type: 'STRING', description: 'Starting point — a saved stop/route label ("home"/"ev", "work"/"iş"), a saved stop name, a free-text address/place, or an exact NSR:StopPlace: id. Omit to use the default saved stop.' },
            to:         { type: 'STRING', description: 'Destination — same resolution as "from". Required.' },
            depart_at:  { type: 'STRING', description: 'ISO 8601 datetime to depart at. Omit for "leave now".' },
            arrive_by:  { type: 'BOOLEAN', description: 'If true, depart_at is the desired ARRIVAL time instead of departure time.' },
            count:      { type: 'NUMBER', description: 'Number of trip alternatives to return (default 3, max 5).' },
          },
          required: ['to'],
        },
      },
    ],
  },
]

// ─── Embeddings (semantic search) ─────────────────────────────────────────
// gemini-embedding-001 @ 768 dims. Cosine index handles the un-normalized
// <3072-dim output, so no manual normalization is needed. Request/response
// shape web-verified (ai.google.dev/gemini-api/docs/embeddings): request
// {content:{parts:[{text}]},taskType,outputDimensionality}; response
// {embedding:{values}} (single) / {embeddings:[{values}]} (batch).
const EMBED_MODEL = 'gemini-embedding-001'
const EMBED_DIMS = 768
const vecLiteral = (v: number[]) => `[${v.join(',')}]`
async function embedTexts(apiKey: string, texts: string[], taskType: string): Promise<(number[] | null)[]> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:batchEmbedContents?key=${apiKey}`
  const body = { requests: texts.map(t => ({ model: `models/${EMBED_MODEL}`, content: { parts: [{ text: t.slice(0, 8000) }] }, taskType, outputDimensionality: EMBED_DIMS })) }
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(`embed ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`)
  const j = await res.json()
  return (j.embeddings ?? []).map((e: AnyRecord) => Array.isArray(e?.values) ? e.values as number[] : null)
}
async function embedOne(apiKey: string, text: string, taskType: string): Promise<number[] | null> {
  const [v] = await embedTexts(apiKey, [text], taskType)
  return v ?? null
}
// Text-rich, simple tables worth embedding for recall (no joins needed).
const EMBED_SOURCES: { table: string; cols: string; text: (r: AnyRecord) => string }[] = [
  { table: 'recipes',        cols: 'id,title,description,instructions', text: r => [r.title, r.description, r.instructions].filter(Boolean).join('\n') },
  { table: 'dev_requests',   cols: 'id,title,description',              text: r => [r.title, r.description].filter(Boolean).join('\n') },
  { table: 'pt_assessments', cols: 'id,feeling,note,assessment',        text: r => [r.feeling, r.note, r.assessment].filter(Boolean).join('\n') },
  { table: 'work_notes',     cols: 'id,content',                        text: r => r.content ?? '' },
  { table: 'ai_memory',      cols: 'id,title,content',                  text: r => [r.title, r.content].filter(Boolean).join('\n') },
  { table: 'wish_items',     cols: 'id,title,notes',                    text: r => [r.title, r.notes].filter(Boolean).join('\n') },
  { table: 'books',          cols: 'id,title,author,review,notes',      text: r => [r.title, r.author, r.review, r.notes].filter(Boolean).join('\n') },
]

async function semanticSearch(args: AnyRecord, authHeader?: string): Promise<AnyRecord> {
  try {
    if (!authHeader) return { success: false, error: 'No auth context for search.' }
    const query = typeof args.query === 'string' ? args.query.trim() : ''
    if (!query) return { success: false, error: 'query is required.' }
    const key = Deno.env.get('GEMINI_API_KEY')
    if (!key) return { success: false, error: 'AI not configured.' }
    const vec = await embedOne(key, query, 'RETRIEVAL_QUERY')
    if (!vec) return { success: false, error: 'Could not embed the query.' }
    const limit = Math.min(Math.max(Number(args.limit) || 8, 1), 25)
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false, autoRefreshToken: false } },
    )
    const { data, error } = await userClient.rpc('ai_semantic_search', { query_embedding: vecLiteral(vec), match_count: limit })
    if (error) return { success: false, error: error.message }
    return { success: true, count: (data ?? []).length, matches: data ?? [] }
  } catch (e) { return { success: false, error: (e as Error).message } }
}

Deno.serve(async (req) => {
  const origin  = req.headers.get('origin')
  const headers = corsHeaders(origin)

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // Auth: EITHER a Supabase user JWT (the browser, validated by getUser below)
  // OR the phone device-secret (x-phone-secret === PHONE_GATEWAY_SECRET → act as
  // the single user). The secret path is why config.toml now sets
  // verify_jwt=false here — same in-code auth pattern as hevy-sync; the JWT path
  // still fully validates via getUser, so the browser flow is unchanged.
  const authHeader   = req.headers.get('authorization') ?? undefined
  const phoneSecret  = Deno.env.get('PHONE_GATEWAY_SECRET')
  const givenSecret  = req.headers.get('x-phone-secret')
  let user: { id: string } | null = null
  if (phoneSecret && givenSecret === phoneSecret) {
    const uid = Deno.env.get('HEVY_USER_ID')          // single-user app, same id everywhere
    if (uid) user = { id: uid }
  } else if (authHeader) {
    const { data } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
    user = data?.user ? { id: data.user.id } : null
  }
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...headers, 'Content-Type': 'application/json' },
    })
  }

  try {
    const body = await req.json() as
      { messages?: Message[]; systemPrompt?: string; responseSchema?: AnyRecord; fetchUrl?: string; model?: string; listModels?: boolean; surface?: string; reindexEmbeddings?: boolean }

    // Debug/maintenance: return the REAL list of models this API key can use
    // (name + generateContent support). Exists so the MODEL_CHAIN above is
    // never guessed again — probe here before adding/renaming any model id.
    if (body.listModels) {
      const key = Deno.env.get('GEMINI_API_KEY')
      if (!key) {
        return new Response(JSON.stringify({ error: 'AI not configured' }), {
          status: 503, headers: { ...headers, 'Content-Type': 'application/json' },
        })
      }
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=100&key=${key}`)
      const j = await r.json()
      const models = (j.models ?? [])
        .filter((m: AnyRecord) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
        .map((m: AnyRecord) => m.name?.replace('models/', ''))
      return new Response(JSON.stringify({ models, chain: MODEL_CHAIN }), {
        status: 200, headers: { ...headers, 'Content-Type': 'application/json' },
      })
    }

    // Fetch-and-extract-text is a distinct, lightweight action (no Gemini
    // call) — used to pull a recipe page's readable text server-side, since
    // the browser can't fetch arbitrary third-party URLs due to CORS.
    if (body.fetchUrl) {
      const text = await fetchPageText(body.fetchUrl)
      return new Response(JSON.stringify({ text }), {
        status: 200, headers: { ...headers, 'Content-Type': 'application/json' },
      })
    }

    // Backfill/refresh the semantic-search index over the user's own text rows.
    // User-triggered (a button); embeds each source table's rows and upserts
    // into ai_embeddings. Idempotent on (user_id, source_table, source_id).
    if (body.reindexEmbeddings) {
      const key = Deno.env.get('GEMINI_API_KEY')
      if (!key) return new Response(JSON.stringify({ error: 'AI not configured' }), { status: 503, headers: { ...headers, 'Content-Type': 'application/json' } })
      const perTable: AnyRecord = {}
      let indexed = 0
      for (const src of EMBED_SOURCES) {
        try {
          const { data: rows } = await supabase.from(src.table).select(src.cols).eq('user_id', user.id).limit(500)
          const withText = (rows ?? []).map((r: AnyRecord) => ({ id: String(r.id), text: src.text(r).trim() })).filter((x: AnyRecord) => x.text)
          let n = 0
          for (let i = 0; i < withText.length; i += 64) {
            const chunk = withText.slice(i, i + 64)
            const vecs = await embedTexts(key, chunk.map((c: AnyRecord) => c.text), 'RETRIEVAL_DOCUMENT')
            const upserts = chunk
              .map((c: AnyRecord, j: number) => vecs[j] ? { user_id: user.id, source_table: src.table, source_id: c.id, content: c.text.slice(0, 4000), embedding: vecLiteral(vecs[j]!), updated_at: new Date().toISOString() } : null)
              .filter(Boolean)
            if (upserts.length) { await supabase.from('ai_embeddings').upsert(upserts, { onConflict: 'user_id,source_table,source_id' }); n += upserts.length }
          }
          perTable[src.table] = n; indexed += n
        } catch (e) { perTable[src.table] = `error: ${(e as Error).message}` }
      }
      return new Response(JSON.stringify({ success: true, indexed, perTable }), { status: 200, headers: { ...headers, 'Content-Type': 'application/json' } })
    }

    const { messages, systemPrompt, responseSchema, model, surface } = body
    if (!messages?.length) {
      return new Response(JSON.stringify({ error: 'messages or fetchUrl required' }), {
        status: 400, headers: { ...headers, 'Content-Type': 'application/json' },
      })
    }

    const GEMINI_KEY = Deno.env.get('GEMINI_API_KEY')
    if (!GEMINI_KEY) {
      return new Response(JSON.stringify({ error: 'AI not configured — add GEMINI_API_KEY to Supabase Vault' }), {
        status: 503, headers: { ...headers, 'Content-Type': 'application/json' },
      })
    }

    // An explicit client-chosen model (the AI panel's model picker) becomes
    // the PREFERRED start of the fallback chain, not the only model tried —
    // manual choice and automatic resilience aren't mutually exclusive; a
    // 503 on the chosen model still falls through to the rest of the chain
    // rather than failing outright.
    // An explicit picker choice wins; otherwise a surface may set its own
    // starting model (still just the PREFERRED start of the fallback chain).
    // The lookup is checked too: `surface` is client input, and a key like
    // "constructor" would otherwise hand back an Object.prototype member.
    const surfaceModel = surface ? SURFACE_MODEL[surface] : undefined
    const preferredModel = isGeminiModel(model) ? model : (isGeminiModel(surfaceModel) ? surfaceModel : undefined)

    // Structured single-shot extraction (no tool-calling loop) — used for
    // things like parsing pasted recipe text into a JSON shape.
    const result = responseSchema
      ? await callGeminiStructured(GEMINI_KEY, messages, systemPrompt, responseSchema, preferredModel)
      : await callGemini(GEMINI_KEY, messages, systemPrompt, supabase, user.id, preferredModel, authHeader, surface)
    return new Response(JSON.stringify(result), {
      status: 200, headers: { ...headers, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    if (err instanceof RateLimitError) {
      return new Response(JSON.stringify({
        error:        'rate_limit',
        daily_limit:  err.dailyLimit,
        retry_after:  err.retryAfterSec,
      }), { status: 429, headers: { ...headers, 'Content-Type': 'application/json' } })
    }
    console.error('[ai-proxy]', err)
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Internal error' }), {
      status: 500, headers: { ...headers, 'Content-Type': 'application/json' },
    })
  }
})

// ─── Per-surface tool sets ────────────────────────────────────────────────
// Every chat surface (general, coach) gets the FULL tool set on purpose: they
// are open conversations that legitimately create tasks / plan time_blocks /
// log food / add shop items, so slicing them would WEAKEN the assistant. The
// Shop page's own chat (the one sliced surface, 'shop') was retired — the
// general chat carries the shop tools — so an old client still sending
// surface 'shop' simply gets the general behaviour here. One identical tool
// list for every chat call also keeps the cacheable prefix byte-identical.
function toolsFor(surface?: string): typeof TOOLS {
  // The phone 'brief' pre-builds its context server-side (phone-gateway), so it
  // needs NO tools — a single-shot answer with no multi-turn tool loop is the
  // phone path's biggest latency win. An empty declaration list is dropped from
  // the request body upstream (Gemini rejects an empty tools array).
  if (surface === 'phone') return [{ functionDeclarations: [] }]
  return TOOLS
}

// Running total of Gemini token usage across a multi-turn call, so the whole
// interaction is logged as one row (cachedContentTokenCount is the PROOF that
// implicit prefix-caching is actually hitting — see the analysis doc).
interface UsageAcc { prompt: number; cached: number; output: number; turns: number }
function addUsage(acc: UsageAcc, meta: AnyRecord | undefined): void {
  if (!meta) return
  acc.prompt += meta.promptTokenCount ?? 0
  acc.cached += meta.cachedContentTokenCount ?? 0
  acc.output += meta.candidatesTokenCount ?? 0
  acc.turns  += 1
}

async function callGemini(
  apiKey: string,
  messages: Message[],
  systemPrompt: string | undefined,
  // deno-lint-ignore no-explicit-any
  supabase: any,
  userId: string,
  preferredModel?: GeminiModel,
  authHeader?: string,
  surface?: string,
): Promise<{ text: string; quickReplies?: string[]; steps?: string[]; model?: string }> {
  const buildUrl = (model: GeminiModel) =>
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`

  // Sticks with whichever model actually served the last turn — a mid-
  // conversation model switch would be a strange (if harmless) inconsistency;
  // if that model degrades mid-conversation, the fallback chain still kicks
  // in again from wherever it left off.
  let modelUsed: GeminiModel = preferredModel ?? DEFAULT_MODEL

  let contents: AnyRecord[] = messagesToContents(messages)

  // Descriptions of each tool call performed — surfaced to the client as an
  // activity trace (shown behind a "Show detail" link, not spoken inline).
  const steps: string[] = []

  // thinking_level MINIMAL keeps latency low while satisfying the thought_signature
  // requirement — but ONLY on Gemini 3.x models (supportsThinking); the 2.5-tier
  // tail of the fallback chain 400s on this field entirely, so the body is
  // built per-model (buildBody), not once and reused across the whole chain.
  // Accumulate token usage across every turn; logged once at the end.
  const usage: UsageAcc = { prompt: 0, cached: 0, output: 0, turns: 0 }

  const baseBody: AnyRecord = { tools: toolsFor(surface) }
  // A surface can opt out of tools entirely (the 'phone' brief — context is
  // pre-built, so a single-shot answer skips the whole tool loop). Gemini
  // rejects an empty tools array, so drop the key when there are no functions.
  const toolList = baseBody.tools as AnyRecord[]
  if (!toolList?.length || !(toolList[0]?.functionDeclarations?.length)) delete baseBody.tools
  if (systemPrompt) {
    baseBody.systemInstruction = { parts: [{ text: systemPrompt }] }
  }
  function buildBodyFor(model: GeminiModel, extra: AnyRecord): AnyRecord {
    return {
      ...baseBody,
      ...extra,
      generationConfig: supportsThinking(model) ? { thinking_config: { thinking_level: 'MINIMAL' } } : undefined,
    }
  }

  try {
  // Multi-turn function calling loop
  for (let turn = 0; turn < 16; turn++) {
    const { res, modelUsed: usedThisTurn } = await fetchGeminiWithFallback(
      apiKey, buildUrl, m => buildBodyFor(m, { contents }), modelUsed,
    )
    modelUsed = usedThisTurn

    if (!res.ok) {
      const errText = await res.text()
      if (res.status === 429) throwRateLimit(errText)
      throw new Error(`Gemini ${res.status}: ${errText}`)
    }

    const data      = await res.json()
    addUsage(usage, data.usageMetadata)
    const candidate = data.candidates?.[0]
    if (!candidate) return { text: '', model: modelUsed }

    const parts: AnyRecord[] = candidate.content?.parts ?? []
    const fnCallParts = parts.filter((p: AnyRecord) => p.functionCall)

    if (fnCallParts.length === 0) {
      // No more function calls — return the text response
      return { text: parts.find((p: AnyRecord) => p.text)?.text ?? '', steps: steps.length ? steps : undefined, model: modelUsed }
    }

    // ask_clarifying_question short-circuits the loop: the "answer" has to
    // come from the human as a real next turn, not a synthesized tool
    // response, so we return immediately instead of continuing the loop.
    const clarifyCall = fnCallParts.find((p: AnyRecord) => p.functionCall.name === 'ask_clarifying_question')
    // Asked together with other calls: none of them runs (one may be the very
    // delete the question asks about), and the model is told so — it then
    // makes the other calls alone and asks in a turn of its own. Returning the
    // question here would silently drop those calls.
    if (clarifyCall && fnCallParts.length > 1) {
      contents = [...contents, candidate.content, {
        role: 'tool',
        parts: fnCallParts.map((part: AnyRecord) => ({ functionResponse: { name: part.functionCall.name, response: {
          success: false, not_run: true,
          error: 'Not run: ask_clarifying_question must be the only call in its turn. Make the other calls on their own first (or drop them), then ask in a separate turn.',
        } } })),
      }]
      continue
    }
    if (clarifyCall) {
      const { question, options } = clarifyCall.functionCall.args
      return { text: question, quickReplies: Array.isArray(options) ? options : [], steps: steps.length ? steps : undefined, model: modelUsed }
    }

    // Preserve candidate.content verbatim — dropping it loses the encrypted thoughtSignature
    // and Gemini 3.x will reject the next turn with a 400.
    contents = [...contents, candidate.content]

    // Dispatch all function calls in this turn (may be parallel), role must be 'tool'
    const toolResponseParts = await Promise.all(
      fnCallParts.map(async (part: AnyRecord) => {
        const { name, args } = part.functionCall
        const result = await dispatch(name, args, supabase, userId, authHeader, surface)
        steps.push(describeStep(name, args, result))
        return { functionResponse: { name, response: result } }
      })
    )
    contents = [...contents, { role: 'tool', parts: toolResponseParts }]
  }

  // Ran out of tool-loop turns. Rather than dead-ending, ask the model (with no
  // tools) to summarize what it did and offer to continue — so the user sees
  // progress and can say "devam et" to resume (chat history is persisted).
  const resumeContents = [...contents, {
    role: 'user',
    parts: [{ text: 'You have reached the step limit for this turn. Do NOT call any tools now. In my language, briefly summarize what you already completed and what still remains, then ask if I want you to continue with the rest.' }],
  }]
  const { res: finalRes, modelUsed: finalModel } = await fetchGeminiWithFallback(
    apiKey, buildUrl,
    m => { const b = buildBodyFor(m, { contents: resumeContents }); delete b.tools; return b },
    modelUsed,
  )
  if (finalRes.ok) {
    const finalData = await finalRes.json()
    addUsage(usage, finalData.usageMetadata)
    const finalText = finalData.candidates?.[0]?.content?.parts?.find((p: AnyRecord) => p.text)?.text
    if (finalText) return { text: finalText, steps: steps.length ? steps : undefined, model: finalModel }
  }
  // Deterministic fallback that still shows exactly what was done + offers to resume.
  // Turkish only on the phone (on-phone text may be Turkish); English on the web.
  const tr = surface === 'phone'
  const doneList = steps.length ? (tr ? '\n\nŞu ana kadar yaptıklarım:\n' : '\n\nDone so far:\n') + steps.map(s => '• ' + s).join('\n') : ''
  return {
    text: tr
      ? `Bu turda çok fazla adım gerektiği için işlemi tek seferde bitiremedim.${doneList}\n\nKaldığım yerden devam etmemi ister misin? "devam et" yaz, sürdüreyim.`
      : `This needed too many steps to finish in one go.${doneList}\n\nShould I carry on from here? Say "continue".`,
    steps: steps.length ? steps : undefined,
    model: finalModel,
  }
  } finally {
    void logUsage(supabase, userId, surface, modelUsed, usage)
  }
}

// One-line description of a tool call for the client-side activity trace.
function describeStep(name: string, args: AnyRecord, result: AnyRecord): string {
  const tbl = args?.table ? ` ${args.table}` : ''
  if (result?.success === false) return `✗ ${name}${tbl} — ${result.error ?? 'error'}`
  let detail = ''
  if (result?.count !== undefined) detail = ` → ${result.count} rows`
  else if (result?.inserted_count !== undefined) detail = ` → ${result.inserted_count} inserted`
  else if (result?.updated_count !== undefined) detail = ` → ${result.updated_count} updated`
  else if (result?.deleted_count !== undefined) detail = ` → ${result.deleted_count} deleted`
  else if (result?.id) detail = ` → id ${result.id}`
  return `✓ ${name}${tbl}${detail}`
}

// Single-shot structured extraction — no tools, no multi-turn loop, just
// "read this text, return JSON matching this schema." Used for pasted-recipe
// parsing and macro estimation, where the caller wants data back, not chat.
async function callGeminiStructured(
  apiKey: string,
  messages: Message[],
  systemPrompt: string | undefined,
  responseSchema: AnyRecord,
  preferredModel?: GeminiModel,
): Promise<{ data: AnyRecord }> {
  const buildUrl = (model: GeminiModel) =>
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`

  const contents: AnyRecord[] = messagesToContents(messages)

  const baseBody: AnyRecord = { contents }
  if (systemPrompt) baseBody.systemInstruction = { parts: [{ text: systemPrompt }] }

  // thinking_config is Gemini-3.x-only (see supportsThinking) — built per
  // model so the 2.5-tier tail of the fallback chain doesn't 400 on it.
  const { res } = await fetchGeminiWithFallback(apiKey, buildUrl, model => ({
    ...baseBody,
    generationConfig: {
      ...(supportsThinking(model) ? { thinking_config: { thinking_level: 'MINIMAL' } } : {}),
      responseMimeType: 'application/json',
      responseSchema,
    },
  }), preferredModel)

  if (!res.ok) {
    const errText = await res.text()
    if (res.status === 429) throwRateLimit(errText)
    throw new Error(`Gemini ${res.status}: ${errText}`)
  }

  const data      = await res.json()
  const text      = data.candidates?.[0]?.content?.parts?.find((p: AnyRecord) => p.text)?.text ?? '{}'
  return { data: JSON.parse(text) }
}

async function dispatch(
  name: string,
  args: AnyRecord,
  // deno-lint-ignore no-explicit-any
  supabase: any,
  userId: string,
  authHeader?: string,
  surface?: string,
): Promise<AnyRecord> {
  switch (name) {
    case 'describe_database':    return describeDatabase(args)
    case 'db_query': {
      const r = await dbQuery(supabase, userId, args)
      void logQuery(supabase, userId, surface, 'db_query', args.table ?? null, args, r)
      return r
    }
    case 'run_read_query': {
      const r = await runReadQuery(args, authHeader)
      void logQuery(supabase, userId, surface, 'run_read_query', null, args, r)
      return r
    }
    case 'db_aggregate': {
      const r = await dbAggregate(supabase, userId, args)
      void logQuery(supabase, userId, surface, 'db_aggregate', args.table ?? null, args, r)
      return r
    }
    case 'get_day_summary':      return getDaySummary(supabase, userId, args)
    case 'get_athlete_profile':  return getAthleteProfile(supabase, userId)
    case 'semantic_search': {
      const r = await semanticSearch(args, authHeader)
      void logQuery(supabase, userId, surface, 'semantic_search', null, args, r)
      return r
    }
    case 'save_memory':          return saveMemory(supabase, userId, args)
    case 'db_insert':            return dbInsert(supabase, userId, args)
    case 'db_update':            return dbUpdate(supabase, userId, args)
    case 'db_delete':            return dbDelete(supabase, userId, args)
    case 'get_media':            return getMedia(supabase, userId, args)
    case 'plan_media':           return planMedia(supabase, userId, args)
    case 'get_calendar_events':  return getCalendarEvents(supabase, userId, args)
    case 'get_health_stats':     return getHealthStats(supabase, userId, args)
    case 'mark_episode_watched': return markEpisodeWatched(supabase, userId, args)
    case 'get_shop_categories':  return getShopCategories(supabase, userId)
    case 'create_shop_category': return createShopCategoryFn(supabase, userId, args)
    case 'create_shop_item':     return createShopItemFn(supabase, userId, args)
    case 'get_next_transit':     return getNextTransit(supabase, userId, args)
    case 'plan_trip':            return planTrip(supabase, userId, args)
    case 'get_saved_transit':    return getSavedTransit(supabase, userId)
    case 'search_transit_stops': return searchTransitStops(args)
    case 'save_transit_stop':    return saveTransitStop(supabase, userId, args)
    case 'save_transit_route':   return saveTransitRoute(supabase, userId, args)
    case 'update_hevy_routine':  return updateHevyRoutine(args, authHeader)
    case 'create_hevy_routine':  return createHevyRoutine(args, authHeader)
    default:                     return { success: false, error: `Unknown function: ${name}` }
  }
}

// Forwards a routine update to the existing hevy-api edge function rather
// than talking to Hevy directly — hevy-api already handles every documented
// payload trap (strips null rep_range, drops folder_id on PUT, unwraps
// Hevy's inconsistent response shapes, re-upserts the result into our DB).
// The user's own Authorization header is passed through so hevy-api's
// owner check still applies.
async function updateHevyRoutine(args: AnyRecord, authHeader?: string): Promise<AnyRecord> {
  if (!authHeader) return { success: false, error: 'No auth context for hevy-api call' }
  let exercises: unknown
  try {
    exercises = typeof args.exercises === 'string' ? JSON.parse(args.exercises) : args.exercises
  } catch {
    return { success: false, error: 'exercises is not valid JSON' }
  }
  if (!Array.isArray(exercises) || exercises.length === 0) {
    return { success: false, error: 'exercises must be a non-empty array (it REPLACES the whole list)' }
  }
  // The routine's OWN note (hevy_routines.notes) is a separate field from any
  // per-exercise note inside `exercises[].notes`. Previously this function
  // only ever forwarded id/title/exercises, so there was NO path at all for
  // the AI to write a routine-level note — hevy-api's update_routine handler
  // already spreads every payload key (minus id/folder_id) into the PUT body,
  // so adding it here is sufficient; hevy-api itself needs no change.
  const payload: AnyRecord = { id: args.routine_id, title: args.title, exercises }
  if (typeof args.notes === 'string') payload.notes = args.notes
  const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/hevy-api`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: authHeader },
    body: JSON.stringify({ action: 'update_routine', payload }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) return { success: false, error: body?.error ?? `hevy-api ${res.status}` }
  return { success: true, message: 'Routine updated in Hevy and synced locally.' }
}

// Creates a routine in the REAL Hevy account via hevy-api (which POSTs to
// Hevy and upserts the local mirror) — same forwarding pattern as
// updateHevyRoutine so every documented Hevy payload trap stays handled in
// ONE place (hevy-api strips null rep_range etc.). Hevy remains the source
// of truth; writing hevy_routines directly would be reverted by the next sync.
async function createHevyRoutine(args: AnyRecord, authHeader?: string): Promise<AnyRecord> {
  if (!authHeader) return { success: false, error: 'No auth context for hevy-api call' }
  let exercises: unknown
  try {
    exercises = typeof args.exercises === 'string' ? JSON.parse(args.exercises) : args.exercises
  } catch {
    return { success: false, error: 'exercises is not valid JSON' }
  }
  if (!Array.isArray(exercises) || exercises.length === 0) {
    return { success: false, error: 'exercises must be a non-empty array' }
  }
  const payload: AnyRecord = { title: args.title, exercises }
  if (args.notes) payload.notes = args.notes
  if (args.folder_id) payload.folder_id = args.folder_id
  const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/hevy-api`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: authHeader },
    body: JSON.stringify({ action: 'create_routine', payload }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) return { success: false, error: body?.error ?? `hevy-api ${res.status}` }
  return { success: true, routine_id: body?.routine_id, message: 'Routine created in Hevy and synced locally.' }
}

// ─── get_media ──────────────────────────────────────────────────────────────
// One compact line per title. entry_id/title/status (+ current_season/
// current_episode for TV) are always there, as before; every other key is left
// out when empty, so a line costs only what is known. The title, release date
// and genres live on the shared catalogue row (movies / tv_series), embedded
// here. Days are the user's own (Europe/Oslo, phone-gateway's convention), as
// yyyy-mm-dd. A watch on an unknown date reads "unknown": Trakt stores it as
// the epoch (episodes keep that) and a completed movie keeps NULL — never let
// it surface as 01.01.1970.
const HOME_TZ = 'Europe/Oslo'
const homeDay = (t: number = Date.now()): string => new Date(t).toLocaleDateString('en-CA', { timeZone: HOME_TZ })

// status → the statuses each table holds for it; null = every status. The
// legacy movie status 'upcoming' is the want-to-watch pool, like wishlist.
const MEDIA_STATUS_SETS: Record<string, { movie: string[] | null; tv: string[] | null }> = {
  active:    { movie: ['watching', 'wishlist', 'upcoming'], tv: ['watching', 'paused', 'wishlist'] },
  wishlist:  { movie: ['wishlist', 'upcoming'],             tv: ['wishlist'] },
  watching:  { movie: ['watching'],                         tv: ['watching'] },
  paused:    { movie: [],                                   tv: ['paused'] },
  completed: { movie: ['completed'],                        tv: ['completed'] },
  dropped:   { movie: ['dropped'],                          tv: ['dropped'] },
  all:       { movie: null,                                 tv: null },
}
const WANT_TO_WATCH = new Set(['wishlist', 'upcoming'])

function watchDay(iso: unknown): string | undefined {
  if (typeof iso !== 'string' || !iso) return undefined
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return undefined
  return t < Date.UTC(1971, 0, 1) ? 'unknown' : homeDay(t)
}
function genreNames(g: unknown): string[] | undefined {
  const names = (Array.isArray(g) ? g : [])
    .map((x: unknown) => typeof x === 'string' ? x : (x as AnyRecord | null)?.name)
    .filter((n: unknown): n is string => typeof n === 'string' && n !== '')
  return names.length ? names : undefined
}
function shortNote(s: unknown, max = 140): string | undefined {
  if (typeof s !== 'string') return undefined
  const t = s.replace(/\s+/g, ' ').trim()
  if (!t) return undefined
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t
}
/** Keeps only the keys that say something (0 stays — a number is a value). */
function knownOnly(o: AnyRecord): AnyRecord {
  const out: AnyRecord = {}
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== false && v !== '') out[k] = v
  return out
}

async function getMedia(supabase: AnyRecord, userId: string, args: AnyRecord): Promise<AnyRecord> {
  const type   = args.type === 'movie' || args.type === 'tv' ? args.type : 'both'
  const status = typeof args.status === 'string' && args.status ? args.status.toLowerCase() : 'active'
  if (!Object.hasOwn(MEDIA_STATUS_SETS, status)) {
    return { success: false, error: `status must be one of ${Object.keys(MEDIA_STATUS_SETS).join(', ')}.` }
  }
  const set   = MEDIA_STATUS_SETS[status]
  const limit = Math.min(Math.max(Math.round(Number(args.limit)) || 25, 1), 100)
  const today = homeDay()
  const results: AnyRecord = { success: true, status }
  let truncated = false

  if (type === 'movie' || type === 'both') {
    if (set.movie && set.movie.length === 0) results.movies = []
    else {
      let q = supabase
        .from('user_movie_entries')
        .select('id, status, rating, is_favorite, personal_note, watched_at, repeat_count, planned_date, movie:movies(title, release_date, genres)')
        .eq('user_id', userId)
      if (set.movie) q = q.in('status', set.movie)
      q = status === 'completed'
        ? q.order('watched_at', { ascending: false, nullsFirst: false })
        : q.order('created_at', { ascending: false })
      const { data, error } = await q.limit(limit)
      if (error) return { success: false, error: error.message }
      const rows: AnyRecord[] = data ?? []
      if (rows.length >= limit) truncated = true
      results.movies = rows.map((e: AnyRecord) => {
        const released = e.movie?.release_date ?? null
        const extra = Math.max(0, Number(e.repeat_count) || 0)
        return {
          entry_id: e.id,
          title:    e.movie?.title,
          status:   e.status,
          ...knownOnly({
            released,
            coming_soon: WANT_TO_WATCH.has(e.status) && !!released && released > today,
            rating:      e.rating,
            genres:      genreNames(e.movie?.genres),
            favorite:    e.is_favorite === true,
            watched:     watchDay(e.watched_at) ?? (e.status === 'completed' ? 'unknown' : undefined),
            plays:       extra > 0 ? extra + 1 : undefined,
            planned:     e.planned_date,
            note:        shortNote(e.personal_note),
          }),
        }
      })
    }
  }

  if (type === 'tv' || type === 'both') {
    let q = supabase
      .from('user_tv_entries')
      .select('id, status, rating, is_favorite, personal_note, current_season, current_episode, started_at, finished_at, planned_date, tv_series:tv_series(title, first_air_date, genres)')
      .eq('user_id', userId)
    if (set.tv) q = q.in('status', set.tv)
    q = status === 'completed'
      ? q.order('finished_at', { ascending: false, nullsFirst: false })
      : q.order('created_at', { ascending: false })
    const { data, error } = await q.limit(limit)
    if (error) return { success: false, error: error.message }
    const rows: AnyRecord[] = data ?? []
    if (rows.length >= limit) truncated = true
    results.tv_series = rows.map((e: AnyRecord) => {
      const firstAired = e.tv_series?.first_air_date ?? null
      return {
        entry_id:        e.id,
        title:           e.tv_series?.title,
        status:          e.status,
        current_season:  e.current_season,
        current_episode: e.current_episode,
        ...knownOnly({
          first_aired: firstAired,
          coming_soon: e.status === 'wishlist' && !!firstAired && firstAired > today,
          rating:      e.rating,
          genres:      genreNames(e.tv_series?.genres),
          favorite:    e.is_favorite === true,
          started:     watchDay(e.started_at),
          finished:    watchDay(e.finished_at),
          planned:     e.planned_date,
          note:        shortNote(e.personal_note),
        }),
      }
    })
  }

  results.count = (results.movies?.length ?? 0) + (results.tv_series?.length ?? 0)
  if (truncated) results.truncated = `Only the first ${limit} per type — raise limit or use db_query for the rest.`
  return results
}

async function planMedia(supabase: AnyRecord, userId: string, args: AnyRecord): Promise<AnyRecord> {
  const { title, media_type, date, season, episode } = args
  const isTV     = media_type === 'tv'
  const taskTitle = isTV
    ? `Watch: ${title} S${season ?? 1}E${episode ?? 1}`
    : `Watch: ${title}`

  // Determine section from date
  const today    = new Date().toISOString().slice(0, 10)
  const tomorrow = new Date(Date.now() + 86400_000).toISOString().slice(0, 10)
  const section  = date === today ? 'today' : date === tomorrow ? 'tomorrow' : 'this_week'

  const { data: task, error: taskErr } = await supabase
    .from('tasks')
    .insert({
      user_id:     userId,
      title:       taskTitle,
      section,
      priority:    'medium',
      domain:      'media',
      due_date:    date,
      status:      'open',
      sort_order:  0,
      source_type: isTV ? 'tv_series' : 'movie',
      source_id:   args.entry_id ?? null,
    })
    .select()
    .single()

  if (taskErr) return { success: false, error: taskErr.message }

  // Create time block: movie=2h purple, TV=45min blue at 20:00. task_id is the
  // ONLY representation of "linked to a Task" (migration 077); source_type/
  // source_id here carry the REAL originating entity, preserved from above
  // rather than overwritten — the pre-077 bug this fixed.
  // NOTE: tasks.source_type uses 'tv_series' but time_blocks.source_type's
  // CHECK (migration 077) only allows 'tv_episode' — the two vocabularies
  // differ on TV specifically; using 'tv_series' here would 400 on the CHECK.
  // season_number/episode_number are the columns cleanup_block_on_episode_
  // watched actually keys off (migration 043) — only stamp them when the AI
  // was given a SPECIFIC episode (mirrors EpisodesPanel's own single-episode
  // rule: never stamped for an unspecified/batch watch, which just means
  // "watch some of this show", not "this exact episode"). When the episode
  // ISN'T known, don't write source_type='tv_episode' either — that value
  // means "this specific episode" and nothing here can back that claim up
  // without the two columns above (mirrors blockSourceTypeForTask's own
  // reasoning on the client: a context-free TV reference is safer as "no
  // block source" than as a falsely episode-specific one).
  const knownEpisode = isTV && season != null && episode != null
  const { error: blockErr } = await supabase.from('time_blocks').insert({
    user_id:          userId,
    date,
    title:            taskTitle,
    start_time:       '20:00:00',
    duration_minutes: isTV ? 45 : 120,
    color:            isTV ? 'blue' : 'purple',
    task_id:          task.id,
    source_type:      isTV ? (knownEpisode ? 'tv_episode' : null) : 'movie',
    source_id:        isTV ? (knownEpisode ? (args.entry_id ?? null) : null) : (args.entry_id ?? null),
    ...(knownEpisode ? { season_number: season, episode_number: episode } : {}),
    updated_at:       new Date().toISOString(),
  })

  if (blockErr) return { success: true, task_id: task.id, warning: 'Task created but schedule block failed' }
  return { success: true, task_id: task.id, title: taskTitle, date, section }
}

async function getCalendarEvents(supabase: AnyRecord, userId: string, args: AnyRecord): Promise<AnyRecord> {
  const daysAhead = Math.min(args.days_ahead ?? 7, 30)

  // Get the refresh token stored from the Google OAuth flow
  const { data: tokenRow, error: tokenErr } = await supabase
    .from('user_calendar_tokens')
    .select('refresh_token')
    .eq('user_id', userId)
    .single()

  if (tokenErr || !tokenRow) {
    return { success: false, error: 'Google Calendar not connected. Connect it in the Calendar section first.' }
  }

  // Exchange refresh token for a short-lived access token
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: tokenRow.refresh_token,
      client_id:     Deno.env.get('GOOGLE_CLIENT_ID')!,
      client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET')!,
      grant_type:    'refresh_token',
    }),
  })

  if (!tokenRes.ok) return { success: false, error: 'Failed to refresh Google Calendar token' }
  const { access_token } = await tokenRes.json()

  const timeMin = new Date().toISOString()
  const timeMax = new Date(Date.now() + daysAhead * 86400_000).toISOString()

  const eventsRes = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&singleEvents=true&orderBy=startTime&maxResults=20`,
    { headers: { Authorization: `Bearer ${access_token}` } }
  )

  if (!eventsRes.ok) return { success: false, error: 'Failed to fetch calendar events' }
  const eventsData = await eventsRes.json()

  const events = (eventsData.items ?? []).map((e: AnyRecord) => ({
    id:       e.id,
    title:    e.summary,
    start:    e.start?.dateTime ?? e.start?.date,
    end:      e.end?.dateTime   ?? e.end?.date,
    location: e.location ?? null,
    all_day:  !e.start?.dateTime,
  }))

  return { success: true, events }
}

// health_metrics is point-in-time grain (one row per incoming sample, not per
// day) — this mirrors the frontend's healthAggregate.ts aggregation rules
// (sum for cumulative quantities, min/max/avg for heart_rate, last-reading
// for resting HR) so the AI reports the same numbers the Health tab shows.
//
// Sleep follows healthAggregate.ts's SLEEP CONTRACT (hand-mirrored — ai-proxy
// is a self-contained Deno function and cannot import it; phone-gateway's
// computeSleepNightsGw is the third copy; scripts/verify-ai-sleep-merge.cjs
// runs the mirror against the web app's computeSleepSummary):
//   1. A night belongs to the day you WOKE UP: the local date of sleepEnd when
//      it carries an offset ("2026-07-17 07:27:08 +0200"), else the row's date.
//   2. A night with any manual row uses ONLY its manual rows — a manual entry
//      is a deliberate correction (these copies used to ignore manual rows, so
//      the AI quoted the Watch's night the user had corrected).
//   3. Pre-aggregated sessions: drop one when >=90% of its own window lies
//      inside a better-ranked session, or less than 15 min of it lies outside
//      one (a re-report or a "Since Last Sync" fragment — summing adds the
//      fragment's WHOLE total, not just its overhang); sum the rest (an
//      interrupted night is two real blocks — "any overlap ⇒ keep the longest"
//      reported 4.35h for a real 8.45h night).
//   4. Raw per-stage rows: Core + REM + Deep + Asleep = total; Awake never added.
const SLEEP_CONTAINMENT = 0.9
const SLEEP_MIN_EXTRA_MS = 15 * 60_000
function sleepMs(s: unknown): number | null {
  if (typeof s !== 'string') return null
  const iso = s.trim().replace(' ', 'T').replace(/\s*([+-]\d{2}):?(\d{2})$/, '$1:$2')
  let t = Date.parse(iso); if (!Number.isFinite(t)) t = Date.parse(s)
  return Number.isFinite(t) ? t : null
}
function sleepNightKeyOf(r: AnyRecord): string {
  const end = r.value?.sleepEnd
  if (typeof end === 'string' && /^\d{4}-\d{2}-\d{2}/.test(end) && /[+-]\d{2}:?\d{2}$/.test(end.trim())) return end.slice(0, 10)
  return String(r.date)
}
/** Rule 3: the night's pre-aggregated rows minus re-reports (untimed rows are kept). */
function mergeSleepSessionRows(pre: AnyRecord[]): AnyRecord[] {
  const timed: { r: AnyRecord; start: number; end: number; total: number; order: number }[] = []
  const untimed: AnyRecord[] = []
  const seen = new Set<string>()
  for (const r of pre) {
    const v = r.value ?? {}
    const key = [v.sleepStart ?? r.recorded_at, v.sleepEnd ?? '', v.totalSleep ?? ''].join('|')
    if (seen.has(key)) continue
    seen.add(key)
    const start = sleepMs(v.sleepStart), end = sleepMs(v.sleepEnd)
    if (start != null && end != null && end > start) timed.push({ r, start, end, total: Number(v.totalSleep) || 0, order: timed.length })
    else untimed.push(r)
  }
  const ranked = [...timed].sort((a, b) => (b.total - a.total) || ((b.end - b.start) - (a.end - a.start)) || (a.order - b.order))
  const kept: typeof timed = []
  for (const s of ranked) {
    const dup = kept.some(k => {
      const overlap = Math.min(s.end, k.end) - Math.max(s.start, k.start)
      const span = s.end - s.start
      return overlap > 0 && span > 0 && (overlap / span >= SLEEP_CONTAINMENT || span - overlap < SLEEP_MIN_EXTRA_MS)
    })
    if (!dup) kept.push(s)
  }
  kept.sort((a, b) => a.start - b.start)
  return [...untimed, ...kept.map(k => k.r)]
}
/** One summary per wake-day night (rules 1–4). */
function summarizeSleepNights(rows: AnyRecord[]): AnyRecord[] {
  const byNight = new Map<string, AnyRecord[]>()
  for (const r of rows) {
    const k = sleepNightKeyOf(r)
    const arr = byNight.get(k)
    if (arr) arr.push(r); else byNight.set(k, [r])
  }
  const r2 = (n: number) => Math.round(n * 100) / 100
  const out: AnyRecord[] = []
  for (const [date, pts] of byNight) {
    const manual = pts.filter(p => p.source === 'manual')
    const src = manual.length > 0 ? manual : pts
    const pre = src.filter(p => typeof p.value?.totalSleep === 'number')
    let core = 0, rem = 0, deep = 0, awake = 0, total = 0
    if (pre.length > 0) {
      for (const p of mergeSleepSessionRows(pre)) {
        const v = p.value
        core += Number(v.core) || 0; rem += Number(v.rem) || 0; deep += Number(v.deep) || 0; awake += Number(v.awake) || 0
        total += typeof v.totalSleep === 'number' ? v.totalSleep : (Number(v.core) || 0) + (Number(v.rem) || 0) + (Number(v.deep) || 0)
      }
    } else {
      let asleep = 0
      for (const p of src) {
        const stage = p.value?.value, qty = p.value?.qty
        if (typeof qty !== 'number') continue
        if (stage === 'Core') core += qty
        else if (stage === 'REM') rem += qty
        else if (stage === 'Deep') deep += qty
        else if (stage === 'Awake') awake += qty
        else if (stage === 'Asleep') asleep += qty
      }
      total = core + rem + deep + asleep
      if (!(total > 0 || awake > 0)) continue
    }
    out.push({ date, hours: r2(total), deep_h: r2(deep), core_h: r2(core), rem_h: r2(rem), awake_h: r2(awake), manual: manual.length > 0 })
  }
  return out.sort((a, b) => String(a.date).localeCompare(String(b.date)))
}

async function computeSleepNights(supabase: AnyRecord, userId: string, since: string): Promise<AnyRecord[]> {
  const { data } = await supabase.from('health_metrics')
    .select('value, date, source, recorded_at').eq('user_id', userId).eq('metric_name', 'sleep_analysis').gte('date', since)
  return summarizeSleepNights((data ?? []) as AnyRecord[])
}

// Mirrors healthAggregate.ts's hour-level dedup (hand-synced, not imported --
// ai-proxy is a self-contained Deno function). REAL BUG, round 1 (2026-09-06,
// live-confirmed): Health Auto Export's `source` field is a "|"-joined list
// of contributing devices, neither deduped nor consistently ordered between
// exports -- the same hour arrived as both "Furkan's Apple Watch" and
// "Furkan's Apple Watch|Furkan's Apple Watch". ROUND 2 (same day, round 1
// wasn't enough): live data showed EVERY hour carries not two but often
// THREE rows -- two exact duplicates (round 1) plus a THIRD at a DIFFERENT
// minute with a DIFFERENT device combination in `source` (e.g. "06:00:00"
// qty=83.7 "Watch|Lasci 17 Pro" and "06:39:34" qty=64.2 "Watch" alone) that a
// per-minute-per-source key still missed and summed on top -- confirmed
// against real numbers: naive-summing one partial day of basal energy came
// to 3309 kcal (physiologically implausible; BMR is ~1600-2400/day),
// hour-level collapse (below) brings the SAME rows to 1164 kcal. The values
// across one hour's rows are nearly identical regardless of which devices
// are listed (77.55 / 77.64 / 77.60 kcal live-confirmed for the SAME real
// hour) -- Health Auto Export is re-reporting the same already-merged
// HealthKit hour total each time its sync automations re-fire, not counting
// a second real device's contribution. Health Auto Export's own "Time
// Grouping: Hours" setting means there should be exactly one row per hour;
// grouping must be by HOUR ONLY, ignoring both the exact minute and the
// source string entirely.
const SUM_METRICS_FOR_DEDUP = new Set(['step_count', 'active_energy', 'basal_energy_burned', 'apple_exercise_time'])

// A row landing exactly on the hour (":00:00") is Health Auto Export's own
// "this hour is now closed" delivery -- prefer it over a mid-hour "partial
// total so far" row even when the partial reads larger. Only when NEITHER
// row for an hour landed on the boundary does the larger of the two win.
function isHourBoundary(recordedAt: string): boolean {
  return recordedAt.slice(14, 19) === '00:00'
}

// ROUND 3 (mirrors healthAggregate.ts's H-06 rule): the hour-only rule
// assumes HOUR-grain rows ("Time Grouping: Hours"). Older rows and any raw
// per-sample export are MINUTE-grain — dozens of independent increments per
// hour — and keeping one row per hour turned 60 × 50 steps into 50. An hour
// with at least MINUTE_GRAIN_MIN_MINUTES distinct minutes is read as
// minute-grain: same-minute twins collapse (largest wins) and the minutes are
// SUMMED. Fewer distinct minutes keeps the hour-only rule above.
// scripts/verify-ai-health-stats-dedup.cjs mirrors this and checks it against
// the web app's collapsedPoints.
const MINUTE_GRAIN_MIN_MINUTES = 7

function collapseDuplicateSumPoints(rows: AnyRecord[]): AnyRecord[] {
  const byHour = new Map<string, AnyRecord[]>()
  const passthrough: AnyRecord[] = []
  for (const r of rows) {
    if (!SUM_METRICS_FOR_DEDUP.has(r.metric_name) || typeof r.value?.qty !== 'number') { passthrough.push(r); continue }
    const key = `${r.metric_name}|${String(r.recorded_at).slice(0, 13)}` // metric + UTC hour bucket
    const arr = byHour.get(key)
    if (arr) arr.push(r); else byHour.set(key, [r])
  }
  const kept: AnyRecord[] = []
  for (const hourRows of byHour.values()) {
    if (hourRows.length === 1) { kept.push(hourRows[0]); continue }
    const perMinute = new Map<string, AnyRecord>()
    for (const r of hourRows) {
      const k = String(r.recorded_at).slice(0, 16)
      const cur = perMinute.get(k)
      if (!cur || r.value.qty > cur.value.qty) perMinute.set(k, r)
    }
    if (perMinute.size >= MINUTE_GRAIN_MIN_MINUTES) { kept.push(...perMinute.values()); continue }
    let winner = hourRows[0]
    for (const r of hourRows.slice(1)) {
      const rIsBoundary = isHourBoundary(String(r.recorded_at)), wIsBoundary = isHourBoundary(String(winner.recorded_at))
      if (rIsBoundary && !wIsBoundary) winner = r
      else if (rIsBoundary === wIsBoundary && r.value.qty > winner.value.qty) winner = r
    }
    kept.push(winner)
  }
  return [...kept, ...passthrough]
}

async function getHealthStats(supabase: AnyRecord, userId: string, args: AnyRecord): Promise<AnyRecord> {
  const days  = Math.min(args.days ?? 7, 30)
  const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10)
  const sleepNights = await computeSleepNights(supabase, userId, since)
  const sleepAvg = sleepNights.length ? Math.round(sleepNights.reduce((a, n) => a + n.hours, 0) / sleepNights.length * 100) / 100 : null
  const sleep = { avg_hours: sleepAvg, last_night: sleepNights.length ? sleepNights[sleepNights.length - 1] : null, nights: sleepNights }
  const METRICS = ['step_count', 'active_energy', 'basal_energy_burned', 'heart_rate', 'resting_heart_rate', 'apple_exercise_time']

  const { data, error } = await supabase
    .from('health_metrics')
    .select('metric_name, date, unit, value, recorded_at, source, source_family')
    .eq('user_id', userId)
    .in('metric_name', METRICS)
    .gte('date', since)

  if (error) return { success: false, error: error.message }
  const rows: AnyRecord[] = data ?? []
  if (!rows.length && !sleepNights.length) return { success: true, message: 'No health data found for this period', averages: {}, daily: [], sleep }

  // Health Auto Export can export energy in kJ depending on locale — always
  // normalize to kcal so numbers match what the Health tab displays.
  const kcal = (qty: number, unit: string | null, metric: string) =>
    (metric === 'active_energy' || metric === 'basal_energy_burned') && unit?.toLowerCase().includes('kj') ? qty / 4.184 : qty

  // Apple Health is the sole data source (the Fitbit/Google Health cross-
  // stream resolver was removed 2026-09-01 along with that whole integration)
  // — no per-window stream competition needed. collapseDuplicateSumPoints
  // still runs (see its own header) to fold HAE's un-deduped "|"-joined
  // source strings back onto one row before summing.
  const resolved: AnyRecord[] = collapseDuplicateSumPoints(rows)

  const byDate = new Map<string, AnyRecord[]>()
  for (const r of resolved) {
    const arr = byDate.get(r.date)
    if (arr) arr.push(r); else byDate.set(r.date, [r])
  }

  const daily = [...byDate.entries()].map(([date, points]) => {
    const of = (name: string) => points.filter(p => p.metric_name === name)
    const sumOf = (name: string) => {
      const qtys = of(name).map(p => typeof p.value?.qty === 'number' ? kcal(p.value.qty, p.unit, name) : null).filter((v): v is number => v != null)
      return qtys.length ? Math.round(qtys.reduce((a, b) => a + b, 0) * 10) / 10 : null
    }
    const hr = of('heart_rate')
    const avgs = hr.map(p => p.value?.Avg).filter((v): v is number => typeof v === 'number')
    const mins = hr.map(p => p.value?.Min).filter((v): v is number => typeof v === 'number')
    const maxs = hr.map(p => p.value?.Max).filter((v): v is number => typeof v === 'number')
    const restingVals = of('resting_heart_rate').map(p => p.value?.qty).filter((v): v is number => typeof v === 'number')

    return {
      date,
      steps:              sumOf('step_count'),
      active_energy_kcal: sumOf('active_energy'),
      basal_energy_kcal:  sumOf('basal_energy_burned'),
      exercise_minutes:   sumOf('apple_exercise_time'),
      heart_rate_avg:     avgs.length ? Math.round(avgs.reduce((a, b) => a + b, 0) / avgs.length) : null,
      heart_rate_min:     mins.length ? Math.min(...mins) : null,
      heart_rate_max:     maxs.length ? Math.max(...maxs) : null,
      resting_heart_rate: restingVals.length ? restingVals[restingVals.length - 1] : null,
    }
  }).sort((a, b) => a.date.localeCompare(b.date))

  const avgKey = (key: string) => {
    const vals = daily.map(d => d[key]).filter((v): v is number => v != null)
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null
  }

  return {
    success: true,
    period_days: days,
    averages: {
      steps:               avgKey('steps'),
      active_energy_kcal:  avgKey('active_energy_kcal'),
      basal_energy_kcal:   avgKey('basal_energy_kcal'),
      exercise_minutes:    avgKey('exercise_minutes'),
      heart_rate_avg:      avgKey('heart_rate_avg'),
      resting_heart_rate:  avgKey('resting_heart_rate'),
      sleep_hours:         sleepAvg,
    },
    sleep,
    daily,
  }
}

async function markEpisodeWatched(supabase: AnyRecord, userId: string, args: AnyRecord): Promise<AnyRecord> {
  // Load current entry to know which series and current progress
  const { data: entry, error: entryErr } = await supabase
    .from('user_tv_entries')
    .select('id, tv_series_id, current_season, current_episode')
    .eq('id', args.entry_id)
    .eq('user_id', userId)
    .single()

  if (entryErr || !entry) return { success: false, error: 'TV entry not found' }

  // The default episode (the one after the highest watched) only exists inside
  // the season that episode is in — another season needs the episode named.
  if (args.season != null && args.episode == null && Number(args.season) !== entry.current_season) {
    return { success: false, error: `Which episode of season ${args.season}? Ask the user — the next episode is only known inside season ${entry.current_season}.` }
  }
  const season  = args.season  ?? entry.current_season
  const episode = args.episode ?? (entry.current_episode + 1)
  const now     = new Date().toISOString()

  // Only what the user actually gave — the old upsert wrote null into an
  // episode's existing rating/note whenever these were omitted.
  const given: AnyRecord = {}
  if (args.rating != null && args.rating !== '') given.rating = args.rating
  if (typeof args.note === 'string' && args.note.trim()) given.personal_note = args.note.trim()

  const { data: existing, error: readErr } = await supabase
    .from('user_tv_episodes')
    .select('id, watched_at')
    .eq('user_id', userId)
    .eq('tv_series_id', entry.tv_series_id)
    .eq('season_number', season)
    .eq('episode_number', episode)
    .maybeSingle()
  if (readErr) return { success: false, error: readErr.message }

  // Already watched (here or on Trakt): keep its real date, like the web app's
  // markEpisodeWatched. Stamping now() over it lost when it was actually seen,
  // and the Trakt outbox (migration 120) then re-dated its plays on Trakt too.
  if (existing?.watched_at) {
    if (Object.keys(given).length) {
      const { error } = await supabase.from('user_tv_episodes').update({ ...given, updated_at: now }).eq('id', existing.id)
      if (error) return { success: false, error: error.message }
    }
    return {
      success: true, season, episode, already_watched: true, watched: watchDay(existing.watched_at),
      message: `S${season}E${episode} was already marked watched — its date was kept.`,
    }
  }

  const { error: epErr } = await supabase
    .from('user_tv_episodes')
    .upsert({
      user_id:        userId,
      tv_entry_id:    entry.id,
      tv_series_id:   entry.tv_series_id,
      season_number:  season,
      episode_number: episode,
      watched_at:     now,
      ...given,
      updated_at:     now,
    }, { onConflict: 'user_id,tv_series_id,season_number,episode_number' })

  if (epErr) return { success: false, error: epErr.message }

  // No write to user_tv_entries.current_season/current_episode: that cache
  // follows user_tv_episodes by itself (migration 050's trigger, the MAX
  // watched episode). Writing (season, episode) here set it BACKWARDS when an
  // earlier episode was marked after a later one.
  return {
    success: true,
    season,
    episode,
    watched_at: now,
    message: `Marked S${season}E${episode} as watched. Progress updated.`,
  }
}

async function getShopCategories(supabase: AnyRecord, userId: string): Promise<AnyRecord> {
  const { data, error } = await supabase
    .from('shop_categories')
    .select('id, name, parent_id')
    .eq('user_id', userId)
    .order('name', { ascending: true })

  if (error) return { success: false, error: error.message }

  const rows = data ?? []
  const top = rows.filter((c: AnyRecord) => !c.parent_id)
  const categories = top.map((t: AnyRecord) => ({
    id:   t.id,
    name: t.name,
    subcategories: rows
      .filter((c: AnyRecord) => c.parent_id === t.id)
      .map((s: AnyRecord) => ({ id: s.id, name: s.name })),
  }))

  return { success: true, categories }
}

async function createShopCategoryFn(supabase: AnyRecord, userId: string, args: AnyRecord): Promise<AnyRecord> {
  const { data, error } = await supabase
    .from('shop_categories')
    .insert({ user_id: userId, name: args.name, parent_id: args.parent_id ?? null })
    .select()
    .single()

  if (error) return { success: false, error: error.message }
  return { success: true, category_id: data.id, name: data.name, is_top: !data.parent_id }
}

// Two lists since migration 134: 'wishlist' (buy someday, filed in a
// subcategory) and 'quick' (the errand/grocery list, category optional).
// A price is only ever one the user stated (price_source 'manual'); its
// currency comes from the user, else from the region.
const SHOP_LISTS = ['wishlist', 'quick']
const SHOP_CURRENCIES = ['NOK', 'TRY', 'EUR', 'USD']
const REGION_CURRENCY: Record<string, string> = { TR: 'TRY', NO: 'NOK' }
// Columns migration 134 adds that create_shop_item writes (the retry drops them).
const SHOP_134_COLUMNS = ['list', 'currency']

// 42703 = Postgres "column does not exist", PGRST204 = PostgREST "Could not
// find the 'x' column … in the schema cache" — only when it names one of them.
const SHOP_134_COLUMN_RE = new RegExp(`\\b(${SHOP_134_COLUMNS.join('|')})\\b`)
const isMissingShop134Column = (e: AnyRecord | null | undefined): boolean =>
  (e?.code === '42703' || e?.code === 'PGRST204') && SHOP_134_COLUMN_RE.test(String(e?.message ?? ''))

async function createShopItemFn(supabase: AnyRecord, userId: string, args: AnyRecord): Promise<AnyRecord> {
  const list = args.list == null || args.list === '' ? 'wishlist' : String(args.list).toLowerCase()
  if (!SHOP_LISTS.includes(list)) return { success: false, error: `list must be "wishlist" or "quick" (got "${args.list}").` }
  const title = typeof args.title === 'string' ? args.title.trim() : ''
  if (!title) return { success: false, error: 'title is required.' }
  const categoryId = typeof args.category_id === 'string' && args.category_id.trim() ? args.category_id.trim() : null
  const needsCategory = 'A wishlist item needs category_id — the most specific fitting category from get_shop_categories, a subcategory or a top category (ask before inventing one).'
  if (list === 'wishlist' && !categoryId) {
    return { success: false, error: `${needsCategory} An errand/grocery item goes on list="quick", where a category is optional.` }
  }

  const price = args.price == null || args.price === '' ? null : Number(args.price)
  if (price != null && !(Number.isFinite(price) && price >= 0)) return { success: false, error: 'price must be a number ≥ 0 — and only a price the user stated.' }
  let currency: string | null = null
  if (args.currency != null && args.currency !== '') {
    currency = String(args.currency).toUpperCase()
    if (!SHOP_CURRENCIES.includes(currency)) return { success: false, error: `currency must be one of ${SHOP_CURRENCIES.join(', ')} (got "${args.currency}").` }
  }
  // The currency the app would show for this row without one: the region's,
  // else NOK — every writer stores it with a price (the app reads NULL as NOK).
  const regionCurrency = typeof args.region === 'string' && Object.hasOwn(REGION_CURRENCY, args.region) ? REGION_CURRENCY[args.region] : 'NOK'
  if (price != null && !currency) currency = regionCurrency

  const row: AnyRecord = {
    user_id:      userId,
    list,
    category_id:  categoryId,
    title,
    notes:        args.notes ?? null,
    price,
    // A stated price is the user's own figure; the AI never estimates one.
    price_source: price != null ? 'manual' : null,
    platform:     args.platform ?? null,
    url:          args.url ?? null,
    priority:     args.priority ?? 'medium',
    region:       args.region ?? null,
    planned_date: args.planned_date ?? null,
    source_type:  'ai',
  }
  if (currency) row.currency = currency

  const insert = (r: AnyRecord) => supabase.from('shop_items').insert(r).select().single()
  let { data, error } = await insert(row)

  // Before migration 134 there is no list/currency column (and category_id is
  // still NOT NULL): retry once without them — every item is a wishlist item
  // then, so it needs a subcategory again.
  let warning: string | undefined
  if (error && isMissingShop134Column(error)) {
    if (!categoryId) {
      return { success: false, error: `The quick list is not available yet (database migration 134 is not applied), so this item can only go on the wishlist. ${needsCategory}` }
    }
    // Before 134 a price has no currency of its own: the app shows it in the
    // region's currency, so a different one would be shown wrong (100 EUR as 100 kr).
    if (currency && currency !== regionCurrency) {
      return { success: false, error: `A price in ${currency} can't be stored yet (database migration 134 is not applied) — only in ${regionCurrency} for this region. Tell the user, or save it without the price.` }
    }
    const legacy: AnyRecord = { ...row }
    for (const c of SHOP_134_COLUMNS) delete legacy[c]
    ;({ data, error } = await insert(legacy))
    if (!error && list === 'quick') warning = 'Database migration 134 is not applied yet, so the quick list could not be used — it was saved on the wishlist. Tell the user.'
  }

  if (error) return { success: false, error: error.message }
  return {
    success: true, item_id: data.id, title: data.title, list: data.list ?? 'wishlist', category_id: data.category_id,
    ...(data.price != null ? { price: data.price, currency: data.currency ?? null } : {}),
    ...(warning ? { warning } : {}),
  }
}

async function getNextTransit(supabase: AnyRecord, userId: string, args: AnyRecord): Promise<AnyRecord> {
  const count = Math.min(args.count ?? 5, 10)
  let stopId: string
  let fallbackName: string

  if (args.stop_id) {
    // Explicit id (e.g. from search_transit_stops) — bypass saved stops entirely.
    if (!/^NSR:StopPlace:\d+$/.test(args.stop_id)) {
      return { success: false, error: 'Invalid stop_id format — use an exact id from search_transit_stops.' }
    }
    stopId = args.stop_id
    fallbackName = args.stop_id
  } else {
    const { data: stops, error: stopsErr } = await supabase
      .from('user_transit_stops')
      .select('stop_id, stop_name, label, is_default')
      .eq('user_id', userId)
      .order('sort_order', { ascending: true })

    if (stopsErr || !stops?.length) {
      return { success: false, error: 'No saved transit stops. Add stops in the Transit widget first, or pass an exact stop_id from search_transit_stops.' }
    }

    // Pick stop: match by name fragment, or fall back to default / first
    const stop = args.stop_name
      ? stops.find((s: AnyRecord) =>
          s.stop_name.toLowerCase().includes(args.stop_name.toLowerCase()) ||
          (s.label ?? '').toLowerCase().includes(args.stop_name.toLowerCase())
        ) ?? stops.find((s: AnyRecord) => s.is_default) ?? stops[0]
      : stops.find((s: AnyRecord) => s.is_default) ?? stops[0]

    // Validate NSR stop_id format to prevent GraphQL injection
    if (!/^NSR:StopPlace:\d+$/.test(stop.stop_id)) {
      return { success: false, error: 'Invalid stop ID format' }
    }
    stopId = stop.stop_id
    fallbackName = stop.label ?? stop.stop_name
  }

  const query = `{
    stopPlace(id: "${stopId}") {
      name
      estimatedCalls(numberOfDepartures: ${count}, timeRange: 7200) {
        realtime
        expectedDepartureTime
        destinationDisplay { frontText }
        serviceJourney { line { publicCode transportMode } }
      }
    }
  }`

  const res = await fetch('https://api.entur.io/journey-planner/v3/graphql', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'ET-Client-Name': 'lasciviens-project-daily' },
    body:    JSON.stringify({ query }),
  })

  if (!res.ok) return { success: false, error: `Transit API error: ${res.status}` }

  const json = await res.json()
  if (json.errors?.length) {
    return { success: false, error: json.errors.map((e: AnyRecord) => e.message).join(' | ') }
  }
  if (!json.data?.stopPlace) return { success: false, error: `Stop not found: ${stopId}` }

  const calls = json.data.stopPlace.estimatedCalls ?? []

  const now = Date.now()
  const departures = calls.map((c: AnyRecord) => {
    const depMs = new Date(c.expectedDepartureTime).getTime()
    const minsUntil = Math.round((depMs - now) / 60_000)
    return {
      line:        c.serviceJourney?.line?.publicCode,
      mode:        c.serviceJourney?.line?.transportMode,
      destination: c.destinationDisplay?.frontText,
      departure:   c.expectedDepartureTime,
      mins_until:  minsUntil,
      realtime:    c.realtime,
    }
  })

  return { success: true, stop: json.data?.stopPlace?.name ?? fallbackName, departures }
}

// ─── Trip planner (plan_trip) ───────────────────────────────────────────────

const ENTUR_CLIENT  = 'lasciviens-project-daily'
const JOURNEY_URL   = 'https://api.entur.io/journey-planner/v3/graphql'
const GEOCODER_URL  = 'https://api.entur.io/geocoder/v1/autocomplete'

type ResolvedPlace =
  | { kind: 'stop';   id: string; name: string }
  | { kind: 'coords'; lat: number; lon: number; name: string }

// "home"/"work" resolution is bounded to this fixed synonym set (Turkish +
// English) — deterministic string matching against the user's OWN saved
// stop/route labels, not something the AI is left to guess or invent.
function placeSynonyms(q: string): string[] {
  const s = q.toLowerCase().trim()
  if (['ev', 'eve', 'evim', 'home'].includes(s)) return ['home', 'ev']
  if (['iş', 'is', 'ise', 'işe', 'work', 'ofis', 'office'].includes(s)) return ['work', 'iş', 'is', 'ofis', 'office']
  return [s]
}

// Geocoder search returning up to `size` candidates — used both to auto-pick
// the top match (fast path) and, when nothing confidently resolves, to hand the
// AI a short list to ask the user about (so it clarifies in ONE follow-up turn
// instead of firing more search tool calls).
async function geocodeCandidates(query: string, size: number): Promise<ResolvedPlace[]> {
  const params = new URLSearchParams({
    text: query, lang: 'no', size: String(size), layers: 'venue,address', 'boundary.country': 'NOR',
  })
  const res = await fetch(`${GEOCODER_URL}?${params.toString()}`, {
    headers: { 'ET-Client-Name': ENTUR_CLIENT },
  })
  if (!res.ok) return []
  const json = await res.json()
  const out: ResolvedPlace[] = []
  for (const f of json.features ?? []) {
    const [lon, lat] = f.geometry?.coordinates ?? []
    const id   = f.properties?.id
    const name = [f.properties?.name ?? f.properties?.label, f.properties?.locality].filter(Boolean).join(', ') || query
    if (typeof id === 'string' && /^NSR:StopPlace:\d+$/.test(id)) out.push({ kind: 'stop', id, name })
    else if (typeof lat === 'number' && typeof lon === 'number')  out.push({ kind: 'coords', lat, lon, name })
  }
  return out
}

// Resolves a free-text place reference against ALREADY-FETCHED saved stops/routes
// (caller loads them once and resolves both endpoints), in this order:
// 1. empty → the user's default saved stop
// 2. exact NSR:StopPlace: id → used directly
// 3. a saved stop whose label/name matches (home/work synonym expansion)
// 4. a saved route whose label matches — uses that route's `endpoint` side
// 5. a free-text address/venue geocoder search (top match)
// Returns null when nothing resolves — the caller then offers candidates to
// the AI so it asks the user, never inventing a place.
async function resolveTransitPlace(
  query: string | undefined,
  endpoint: 'from' | 'to',
  stops: AnyRecord[],
  routes: AnyRecord[],
): Promise<ResolvedPlace | null> {
  if (!query) {
    const def = stops.find(s => s.is_default) ?? stops[0]
    return def ? { kind: 'stop', id: def.stop_id, name: def.label ?? def.stop_name } : null
  }

  if (/^NSR:StopPlace:\d+$/.test(query.trim())) {
    // Name is filled in later from the trip legs — no extra lookup call.
    return { kind: 'stop', id: query.trim(), name: query.trim() }
  }

  const synonyms  = placeSynonyms(query)
  const stopMatch = stops.find(s =>
    synonyms.some(syn => (s.label ?? s.stop_name).toLowerCase().includes(syn) || s.stop_name.toLowerCase().includes(syn))
  )
  if (stopMatch) return { kind: 'stop', id: stopMatch.stop_id, name: stopMatch.label ?? stopMatch.stop_name }

  const routeMatch = routes.find(r => synonyms.some(syn => r.label.toLowerCase().includes(syn)))
  if (routeMatch) {
    return endpoint === 'to'
      ? { kind: 'stop', id: routeMatch.to_stop_id,   name: routeMatch.to_stop_name   }
      : { kind: 'stop', id: routeMatch.from_stop_id, name: routeMatch.from_stop_name }
  }

  return (await geocodeCandidates(query, 1))[0] ?? null
}

// Only ever injects a regex-validated NSR id or finite numeric coordinates
// into the GraphQL string — never the raw AI-provided query text.
function gqlPlace(p: ResolvedPlace): string {
  if (p.kind === 'stop') return `{ place: "${p.id}" }`
  return `{ coordinates: { latitude: ${p.lat}, longitude: ${p.lon} } }`
}

async function planTrip(supabase: AnyRecord, userId: string, args: AnyRecord): Promise<AnyRecord> {
  // Load saved stops + routes ONCE, then resolve both endpoints against them
  // (previously each endpoint re-queried both tables — up to 4 queries).
  const [stopsRes, routesRes] = await Promise.all([
    supabase.from('user_transit_stops')
      .select('stop_id, stop_name, label, is_default').eq('user_id', userId)
      .order('sort_order', { ascending: true }),
    supabase.from('user_transit_routes')
      .select('label, from_stop_id, from_stop_name, to_stop_id, to_stop_name').eq('user_id', userId),
  ])
  const stops  = stopsRes.data ?? []
  const routes = routesRes.data ?? []

  const [from, to] = await Promise.all([
    resolveTransitPlace(args.from, 'from', stops, routes),
    resolveTransitPlace(args.to,   'to',   stops, routes),
  ])

  // When a side won't resolve, hand back a few candidates for THAT side so the
  // AI can ask the user one focused clarifying question (with tappable options)
  // in a single turn — instead of firing more search tool calls or guessing.
  if (!from || !to) {
    const which   = !from ? 'from' : 'to'
    const rawText = (!from ? args.from : args.to) as string | undefined
    const candidates = rawText ? await geocodeCandidates(rawText, 4) : []
    return {
      success: false,
      needs_clarification: true,
      unresolved: which,
      unresolved_query: rawText ?? '(default stop, none saved)',
      candidates: candidates.map(c => c.name),
      hint: rawText
        ? `Could not confidently resolve the ${which} place "${rawText}". Ask the user which of "candidates" they mean (use ask_clarifying_question with those as options), or ask for a clearer place name. Do NOT guess.`
        : `No ${which} place given and the user has no saved default stop. Ask the user where they are starting from.`,
    }
  }
  if (from.kind === 'stop' && to.kind === 'stop' && from.id === to.id) {
    return { success: false, error: 'Start and destination resolved to the same stop — ask the user to clarify.' }
  }

  const count = Math.min(Math.max(args.count ?? 3, 1), 5)

  let dateTimeIso: string | null = null
  if (args.depart_at) {
    const parsed = new Date(args.depart_at)
    if (isNaN(parsed.getTime())) return { success: false, error: 'depart_at is not a valid date/time' }
    dateTimeIso = parsed.toISOString()
  }
  const dtArg = dateTimeIso ? `\n      dateTime: "${dateTimeIso}"` : ''
  const abArg = args.arrive_by ? `\n      arriveBy: true` : ''

  const query = `{
    trip(
      from: ${gqlPlace(from)}
      to:   ${gqlPlace(to)}
      numTripPatterns: ${count}${dtArg}${abArg}
    ) {
      tripPatterns {
        duration
        expectedStartTime
        expectedEndTime
        legs {
          mode
          fromPlace { name }
          toPlace   { name }
          line { publicCode transportMode }
          fromEstimatedCall {
            expectedDepartureTime
            destinationDisplay { frontText }
          }
          toEstimatedCall { expectedArrivalTime }
        }
      }
    }
  }`

  const res = await fetch(JOURNEY_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'ET-Client-Name': ENTUR_CLIENT },
    body:    JSON.stringify({ query }),
  })

  if (!res.ok) return { success: false, error: `Transit API error: ${res.status}` }

  const json = await res.json()
  if (json.errors?.length) {
    return { success: false, error: json.errors.map((e: AnyRecord) => e.message).join(' | ') }
  }

  const patterns = json.data?.trip?.tripPatterns ?? []
  if (patterns.length === 0) return { success: false, error: 'No trips found between these two places.' }

  const trips = patterns.map((p: AnyRecord) => ({
    duration_minutes: p.duration ? Math.round(p.duration / 60) : null,
    departure:         p.expectedStartTime,
    arrival:           p.expectedEndTime,
    legs: (p.legs ?? [])
      .filter((l: AnyRecord) => l.mode && l.fromPlace && l.toPlace)
      .map((l: AnyRecord) => ({
        mode:        l.mode,
        line:        l.line?.publicCode ?? null,
        from:        l.fromPlace.name,
        to:          l.toPlace.name,
        destination: l.fromEstimatedCall?.destinationDisplay?.frontText ?? null,
        departure:   l.fromEstimatedCall?.expectedDepartureTime ?? null,
        arrival:     l.toEstimatedCall?.expectedArrivalTime ?? null,
      })),
  }))

  // Prefer real stop names from the trip itself (first leg's origin / last
  // leg's destination) over the resolved label — this is how a bare id passed
  // in as from/to gets a human name without any extra lookup call.
  const firstTripLegs = trips[0]?.legs ?? []
  const fromName = firstTripLegs[0]?.from ?? from.name
  const toName   = firstTripLegs[firstTripLegs.length - 1]?.to ?? to.name

  return { success: true, from: fromName, to: toName, trips }
}

// Lets the AI inspect exactly what the user has saved before guessing at
// "home"/"work"/an ambiguous label — always safer than relying on the
// synonym-matching inside resolveTransitPlace alone.
async function getSavedTransit(supabase: AnyRecord, userId: string): Promise<AnyRecord> {
  const [{ data: stops }, { data: routes }] = await Promise.all([
    supabase
      .from('user_transit_stops')
      .select('stop_id, stop_name, label, is_default')
      .eq('user_id', userId)
      .order('sort_order', { ascending: true }),
    supabase
      .from('user_transit_routes')
      .select('label, from_stop_id, from_stop_name, to_stop_id, to_stop_name')
      .eq('user_id', userId)
      .order('sort_order', { ascending: true }),
  ])

  return {
    success: true,
    stops: (stops ?? []).map((s: AnyRecord) => ({
      id: s.stop_id, name: s.stop_name, label: s.label, is_default: s.is_default,
    })),
    routes: (routes ?? []).map((r: AnyRecord) => ({
      label: r.label,
      from: { id: r.from_stop_id, name: r.from_stop_name },
      to:   { id: r.to_stop_id,   name: r.to_stop_name },
    })),
  }
}

// Free-text search over ANY stop/address (not just saved ones) — lets the AI
// disambiguate or find a precise id to pass into plan_trip/get_next_transit
// instead of relying on fuzzy resolution.
async function searchTransitStops(args: AnyRecord): Promise<AnyRecord> {
  const query = (args.query ?? '').trim()
  if (!query) return { success: false, error: 'query is required' }

  const params = new URLSearchParams({
    text: query, lang: 'no', size: '8', layers: 'venue,address', 'boundary.country': 'NOR',
  })
  const res = await fetch(`${GEOCODER_URL}?${params.toString()}`, {
    headers: { 'ET-Client-Name': ENTUR_CLIENT },
  })
  if (!res.ok) return { success: false, error: `Geocoder error: ${res.status}` }

  const json = await res.json()
  const results = (json.features ?? []).map((f: AnyRecord) => ({
    id:       f.properties?.id ?? null,
    name:     f.properties?.name ?? f.properties?.label ?? null,
    locality: f.properties?.locality ?? f.properties?.county ?? null,
    layer:    f.properties?.layer ?? null,
  })).filter((r: AnyRecord) => r.id && r.name)

  if (results.length === 0) return { success: false, error: `No matches for "${query}"` }
  return { success: true, results }
}

// Mirrors the client's useTransitStops().addStop — first saved stop becomes
// the default automatically; explicitly requesting is_default demotes any
// other current default via the same two-step clear-then-set as the client.
async function saveTransitStop(supabase: AnyRecord, userId: string, args: AnyRecord): Promise<AnyRecord> {
  const stopId   = (args.stop_id ?? '').trim()
  const stopName = (args.stop_name ?? '').trim()

  if (!/^NSR:StopPlace:\d+$/.test(stopId)) {
    return { success: false, error: 'stop_id must be an exact NSR:StopPlace: id — get one from search_transit_stops first.' }
  }
  if (!stopName) return { success: false, error: 'stop_name is required' }

  const { data: existing } = await supabase
    .from('user_transit_stops')
    .select('id')
    .eq('user_id', userId)

  const isFirst = !existing?.length

  const { data, error } = await supabase
    .from('user_transit_stops')
    .insert({
      user_id:    userId,
      stop_id:    stopId,
      stop_name:  stopName,
      label:      args.label ?? null,
      is_default: args.is_default ?? isFirst,
      sort_order: existing?.length ?? 0,
    })
    .select('id')
    .single()

  if (error) {
    if (error.code === '23505') return { success: false, error: 'This stop is already saved.' }
    return { success: false, error: error.message }
  }

  if (args.is_default && !isFirst) {
    await supabase.from('user_transit_stops').update({ is_default: false }).neq('id', data.id).eq('user_id', userId)
  }

  return { success: true, id: data.id, stop_id: stopId, label: args.label ?? stopName }
}

async function saveTransitRoute(supabase: AnyRecord, userId: string, args: AnyRecord): Promise<AnyRecord> {
  const label    = (args.label ?? '').trim()
  const fromId   = (args.from_stop_id ?? '').trim()
  const fromName = (args.from_stop_name ?? '').trim()
  const toId     = (args.to_stop_id ?? '').trim()
  const toName   = (args.to_stop_name ?? '').trim()

  if (!label) return { success: false, error: 'label is required (e.g. "Home", "Work")' }
  if (!/^NSR:StopPlace:\d+$/.test(fromId) || !/^NSR:StopPlace:\d+$/.test(toId)) {
    return { success: false, error: 'from_stop_id/to_stop_id must be exact NSR:StopPlace: ids — get them from search_transit_stops or get_saved_transit first.' }
  }
  if (!fromName || !toName) return { success: false, error: 'from_stop_name/to_stop_name are required' }

  const { count } = await supabase
    .from('user_transit_routes')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)

  const { data, error } = await supabase
    .from('user_transit_routes')
    .insert({
      user_id:        userId,
      label,
      from_stop_id:   fromId,
      from_stop_name: fromName,
      to_stop_id:     toId,
      to_stop_name:   toName,
      sort_order:     count ?? 0,
    })
    .select('id')
    .single()

  if (error) return { success: false, error: error.message }
  return { success: true, id: data.id, label }
}

// ─── Generic DB access layer ────────────────────────────────────────────────
// Curated allow-list of the user's OWN data tables the assistant may touch.
// access 'rw' = read+write, 'ro' = read-only (externally synced — writing here
// would desync from the source system). Any table NOT listed here is
// unreachable — this is how token/secret/auth tables stay private (default-deny).
interface CatalogEntry { access: 'rw' | 'ro'; purpose: string; columns: string; rules?: string }

const DB_CATALOG: Record<string, CatalogEntry> = {
  // ── read+write (the user's own app data) ──
  tasks: {
    access: 'rw',
    purpose: 'To-do tasks (the To-Do feature IS this table).',
    columns: 'id, title, description, domain(personal|work|media), section(inbox|today|tomorrow|this_week|backlog), status(open|in_progress|waiting|done|cancelled), priority(low|medium|high), start_date(date; optional opening edge of a window — with due_date it means "do this between A and B"), due_date(date), due_time(time), waiting_for(text), is_focused(bool), source_type(manual|movie|tv_series|media|calendar|ai|training_session|project_item), source_id(uuid), sort_order, completed_at(timestamptz — when it was closed; use this, never updated_at, for "finished today"), created_at, updated_at',
    rules: 'Deleting a task automatically deletes its linked time_blocks row too (task_id is ON DELETE CASCADE — no separate cleanup db_delete needed). due_date is the SOLE deadline — a task with a due_date can be late; a task\'s optional schedule slot (time_blocks linked via task_id) is a separate fact and never implies or changes due_date. If the user just wants to be reminded of something during a period ("go to the hytte this winter") with no date it must be done by, that is a wish_items row, not a task.',
  },
  time_blocks: {
    access: 'rw',
    purpose: 'One-off day schedule / timeline blocks for a specific date.',
    columns: 'id, date(date), title, start_time(time HH:MM:SS), duration_minutes(int), color(blue|green|orange|purple|accent|red), category(daily|training|media|games|work|projects|other), task_id(uuid; the ONLY representation of "linked to a Task" — never source_type), source_type(training_session|movie|tv_episode|project_item|calendar|manual; the REAL originating entity, independent of task_id, never "task"), source_id(uuid), notes, created_at, updated_at',
    rules: 'Set category to match the block type (e.g. "training" for a planned workout) — training/media/work calendar views filter by it. To reschedule to another day, update the date column. To link a block to a task, set task_id — never set source_type to "task".',
  },
  recipes: {
    access: 'rw',
    purpose: 'Saved food recipes (a dish). A recipe is NEVER a shopping item — never put a recipe in shop_items.',
    columns: 'id, title, description, servings(int>0), instructions(text; one step per line), macro_mode(manual|from_ingredients), calories, protein_g, carbs_g, fat_g, sugar_g (numeric, PER SERVING), image_url, source_url, times_cooked(int), created_at, updated_at',
    rules: 'Store title/instructions/ingredient names in TURKISH (translate if needed). For AI-entered macros use macro_mode="manual". Ingredient rows go in recipe_ingredients with recipe_id.',
  },
  recipe_ingredients: {
    access: 'rw',
    purpose: 'Ingredient rows belonging to a recipe.',
    columns: 'id, recipe_id(uuid FK recipes), name, quantity(numeric; null="to taste"), unit, note, sort_order, library_ingredient_id(uuid FK recipe_ingredient_library, nullable)',
  },
  recipe_ingredient_library: {
    access: 'rw',
    purpose: 'Reusable ingredient catalog with macros per 100g.',
    columns: 'id, name(unique per user), unit(default g), calories, protein_g, carbs_g, fat_g, sugar_g (per 100g), created_at',
  },
  food_log_entries: {
    access: 'rw',
    purpose: "The unified FOOD JOURNAL — both what the user ATE (status='eaten', macros snapshotted) and what they PLAN to eat (status='planned', macros computed live, so leave macro columns null on planned rows). The old recipe_meal_plans table was merged in here (migration 061). When the user says they ate something ('100g tavuk yedim'), insert status='eaten' with macros resolved from recipe_ingredient_library (per-100g × grams/100) as a SNAPSHOT. Multiple rows per slot are normal.",
    columns: "id, date(date), meal_slot(breakfast|lunch|dinner|snack|supplement), status('planned'|'eaten', default 'eaten'), library_ingredient_id(uuid nullable), recipe_id(uuid nullable), custom_title(text nullable), quantity(numeric — grams for ingredients, servings for recipes), unit(text, e.g. 'g' or 'serving'), calories, protein_g, carbs_g, fat_g, fiber_g, sugar_g (numeric — a snapshot for eaten rows, null for planned), created_at",
    rules: "At least one of library_ingredient_id/recipe_id/custom_title must be set. For status='eaten' compute+store the macro snapshot at insert (never null when the ingredient has per-100g values). For status='planned' leave macros null (computed live on read). 'How much did I eat today?' → sum status='eaten' rows for the date. Water never goes here — it is water_log_entries.",
  },
  // Water (migration 067) is its own table, never a food slot: it has no macros
  // and the calorie ring must never count it. No updated_at column (rows are
  // only ever inserted or deleted), so none is listed below — dbInsert/dbUpdate
  // add updated_at only when the columns string names it.
  water_log_entries: {
    access: 'rw',
    purpose: "The water diary — one row per amount the user drank. The day's total is the SUM of amount_ml for that date; the daily target is day_targets.water_ml.",
    columns: "id, date(date — the user's own day, yyyy-mm-dd; set it from the context's ISO date — left out, today in Oslo is used), amount_ml(int > 0), logged_at(timestamptz — when it was logged, default now), created_at",
    rules: "One row per amount drunk: 'I drank 500 ml' → insert {date, amount_ml: 500}; never edit a row into a running total. A glass with no amount given = 250 ml (the app's default); for anything else ask the amount once. Water NEVER goes in food_log_entries and has no macros or calories. 'How much water today?' → db_aggregate sum amount_ml with filters {date}. To take back the last amount, delete that row (newest logged_at) after the user confirms.",
  },
  shop_categories: {
    access: 'rw',
    purpose: 'Shopping categories — a STRICT 2-level tree (top category → subcategory) that shop_items are filed under.',
    columns: 'id, name, parent_id(uuid; null=top category, set=subcategory), created_at',
    rules: 'Items attach to a SUBCATEGORY (a category whose parent_id is set), never to a top category.',
  },
  shop_items: {
    access: 'rw',
    purpose: 'Things to BUY and the things the user owns or owned (migration 137). A row\'s life on the wishlist side: To buy (status=wishlist) → Mine (status=bought) → Sold or gone (status=bought + disposal facts). A POSSESSION is list=wishlist AND kind=item AND status=bought AND kept=true. list="quick" = the short errand/grocery list (a tick there is "picked up", never a possession). kind="general" = a general wish ("a tablet with a pen, 5 000–8 000 NOK") whose models are rows with option_for = its id; it becomes status=fulfilled by itself when a model is bought. accessory_of = an accessory of that item. A recipe is never a shop item, and neither is a thing to DO or a place to GO — "go skiing this winter" is a wish_items row.',
    columns: 'id, list(wishlist|quick), kind(item|general), category_id(uuid FK shop_categories, nullable), title, notes, price(numeric — to buy: the expected price; bought: what was paid, 0 = came with it), currency(NOK|TRY|EUR|USD), price_source(manual|ai_estimate), price_min/price_max(a general wish\'s range), requirements(a general wish\'s must-haves, one per line), option_for(uuid — a model of that general wish), meets(jsonb — a model\'s true/false per requirement), accessory_of(uuid — an accessory of that item), reason(need|fun), platform(the store), url(a Prisjakt or shop link — its price is checked daily), image_url, ean, priority(low|medium|high — on the quick list low = "No rush"), region(TR|NO), planned_date(date — buy on, or a deal\'s "from" day), wait_for_deal(bool), target_price, deal_note, errand(bool — a wishlist row also shown on the quick list), status(wishlist|bought|dropped|fulfilled), bought_at(timestamptz — stamped by the database), fx_nok/fx_source(the NOK rate of the purchase day — filled by the database, never write them), market_price/market_currency(the normal price at the time — "saved"), used, got_as_gift, for_resale(bought to sell later), kept(false = bought for someone else or used up — spending only), approx_dates(the days are a guess), serial, return_by(date), warranty_until(date — "can complain until"), value_now/value_currency/value_on(the user\'s own "Could sell for" estimate and its day), disposal(sold|traded_in|returned|given|broken|lost|other), disposed_on(date), sale_price/sale_currency(money back), sale_fx_nok/sale_fx_source(database-filled), sold_to, sale_group(rows sold together), task_id(uuid FK tasks), source_type(manual|ai), created_at, updated_at, chain_name(migration 138 — the name the user gave a money chain; it sits on one thing of the chain, normally its oldest)',
    rules: [
      'Add things to buy with create_shop_item (it handles the list, the currency and the category rule).',
      'Never estimate, look up or invent a price, a sale price or a "Could sell for": store only amounts the user stated, with their currency (none given: TR → TRY, otherwise NOK) and price_source="manual".',
      'Marking bought: update status to bought — never write bought_at, fx_nok, fx_source, sale_fx_nok or sale_fx_source (the database fills them, at the rate of the day).',
      'Selling or giving something away NEVER deletes the row: set disposal, disposed_on and, when there was money back, sale_price + sale_currency (and sold_to when known). If its accessories went with it, set the same facts on each accessory with its share of the money and one shared sale_group uuid. Confirm before writing.',
      'Undoing a sale: set disposal to null (the rest is cleared by the database). A sold row cannot go back to status=wishlist until its sale is undone.',
      'A general wish has no price of its own and is never bought itself — add its models as rows with option_for and buy a model.',
      'To plan a purchase as a task, create the tasks row first, then set this item\'s task_id to its id.',
      'Naming a money chain: set chain_name on the chain\'s thing that already carries a name, else on its oldest thing (a chain = things joined by shop_item_links); null removes it. Two names in one chain: the oldest thing\'s wins.',
      'Columns from migration 138 (chain_name), 137 (kind, accessory_of, disposal, …) or 134 (list, currency, bought_at, task_id): if a write says one does not exist, retry without it and tell the user what could not be stored.',
    ].join(' '),
  },
  shop_item_links: {
    access: 'rw',
    purpose: 'Money chains: to_id was (or will be) paid with the money from selling from_id. from_id = one of the user\'s things (not an accessory); to_id = a thing, a thing to buy or a general wish. A link from a thing still owned, or to a wish, is a plan.',
    columns: 'id, from_id(uuid FK shop_items), to_id(uuid FK shop_items), amount(numeric, nullable — how much of that sale went there, in the sale\'s currency; null = the rest, shared by the receivers\' prices), created_at',
    rules: 'Add a link only when the user says the money from one thing went (or will go) to another. The database refuses a loop and a link from an accessory or an errand.',
  },
  shop_item_costs: {
    access: 'rw',
    purpose: 'Extra costs on a shop item the user has or had: repairs, shipping, fees, insurance — a rebate or cashback is a NEGATIVE amount.',
    columns: 'id, item_id(uuid FK shop_items), label, amount(numeric ≠ 0), currency(NOK|TRY|EUR|USD), spent_on(date), fx_nok/fx_source(database-filled — never write them), created_at, updated_at',
    rules: 'Only amounts the user stated. One row per cost.',
  },
  shop_price_watch: {
    access: 'ro',
    purpose: 'The last price read from each shop item\'s link (Prisjakt\'s lowest and how many shops, or the shop\'s own price), written by the daily price check.',
    columns: 'item_id, url, checked_at, status(ok|no_price|blocked|error), error, source(prisjakt|store), name, low, high, offers, currency, in_stock, was(a struck-out "before" price), return_days, last_ok_at, prev_low, prev_at',
    rules: 'Say where and when a price is from ("Prisjakt\'s lowest on 08.10.2026"). A blocked or failed check keeps the last price read — say it is from last_ok_at.',
  },
  shop_price_points: {
    access: 'ro',
    purpose: 'Every price read of a shop item\'s link — the history behind shop_price_watch.',
    columns: 'id, item_id, checked_at, low, high, offers, currency, source',
  },
  fx_rates_nok: {
    access: 'ro',
    purpose: 'Norges Bank\'s daily exchange rates to NOK for TRY, EUR and USD (one row per calendar day; a weekend carries Friday\'s). Shop uses them to freeze a purchase\'s or a sale\'s NOK value on its own day.',
    columns: 'day(date), currency(TRY|EUR|USD), nok_per_unit(NOK for 1 unit), rate_day(the business day the rate is from), fetched_at',
  },
  // wish_items is rw for the same reason dev_requests is: the user dictates
  // wishes in chat ("let's go to the hytte this winter") and on the phone via
  // the Siri ask-AI shortcut, which runs the FULL tool set — so one flat db_insert
  // here is the app's best capture channel for them. There are now FOUR
  // "remember this for me" targets and they have been confused before (a
  // pasted recipe once landed in shop_items under an invented category); the
  // rules below are the tie-breaker. Announce before writing, confirm before
  // deleting, like every other write.
  wish_items: {
    access: 'rw',
    purpose: 'Wishes — things the user wants to DO, or places they want to GO, optionally scoped to a reminder period ("go to the hytte this winter", "a ski trip this winter", "maybe an Italy trip this spring", "things to do in Polatli"). Use kind="place" for a destination, kind="thing" for everything else.',
    columns: 'id, title, notes, kind(thing|place — default thing), period_start(date), period_end(date), period_label(text — the user\'s own word for the period, e.g. "Winter"), city, country, url (the three are meaningful when kind="place"), priority(low|medium|high), status(idea|planned|done|dropped — default idea), promoted_task_id(uuid FK tasks — set when the wish was scheduled as a real task; the wish row survives), sort_order, created_at, updated_at',
    rules: [
      'A PERIOD IS A REMINDER WINDOW, NEVER A DEADLINE. A wish is never late, never overdue, never urgent because its period is near or past. Never say a wish is due, never compute lateness for one, and never change its status just because period_end has passed — it stays "idea" until the user closes it.',
      'If it MUST be done by a date, it is a tasks row with a due_date, not a wish.',
      'Pick the right home for a note — there are four: dev_requests = a request about THIS APP (a bug, a feature, an idea for the app itself). ai_memory = a durable fact/preference about the user to recall later. shop_items = something to BUY. wish_items = something to DO or a place to GO, with an optional period.',
      'Set period_start/period_end to CONCRETE dates (yyyy-mm-dd) resolved from what the user said; the current date is in the context turn. Leave both null for an "anytime" wish. period_label is optional and holds the user\'s own word for the window.',
      'Write title/notes in the language the user used. Only set status="done" or "dropped" when the user says so, and never delete a wish without explicit confirmation.',
    ].join(' '),
  },
  books: {
    access: 'rw',
    purpose: 'The book library (Books page). Most rows come from the Kobo (KOReader plugin: Nickel\'s library + reading statistics); the user may add books by hand, rate them, and write reviews.',
    columns: 'id, title, author, series, series_index, language, isbn, publisher, published_year, description, page_count, cover_url, kind(book|news — a News Downloader issue), read_status(want|reading|finished|paused|dropped; NULL for news), rating(1-10, 2 per star), categories(text[] — the user\'s own shelves, e.g. {Fantasy,Work}), subjects(text[] — topics from the file), file_size(bytes on the Kobo), review(the user\'s own words), notes, started_at, finished_at, queue_order(the reading queue among want), progress_pct(0-100, from the Kobo), last_read_at, read_seconds(KOReader lifetime reading time), read_pages, on_device(boolean), source(koreader|kobo|manual), koreader_md5, created_at, updated_at',
    rules: [
      'Reading TIME per day lives in reading_page_events (aggregate duration_seconds by day); read_seconds is a per-book lifetime total from the device.',
      'Never change koreader_md5, progress_pct, read_seconds, read_pages, last_read_at or on_device — the Kobo sync owns them.',
      'A review or note the user dictates goes into review/notes of the right book (find it by title with ilike first). Confirm before deleting a book: its reading history is deleted with it.',
      'Something to READ later that is not in the library yet: insert with read_status="want", source="manual", on_device=false.',
      'News (kind="news") never has a status, rating, queue place or read dates — the database clears them; leave them alone and filter kind="book" when the user means books.',
      'To put a book on a shelf, update categories with the WHOLE new array (read it first, then add); reuse the spelling already used in other books (db_query the categories first) so one shelf is never two.',
    ].join(' '),
  },
  reading_page_events: {
    access: 'ro',
    purpose: 'KOReader reading statistics from the Kobo: one row per page view (page, started_at, duration_seconds, book_id → books.id). Use db_aggregate (sum duration_seconds, group by day) for minutes read; rows arrive late (whenever the Kobo has Wi-Fi), so a recent day with no rows may simply not be synced yet.',
    columns: 'id, book_id(uuid FK books), page, started_at(timestamptz), duration_seconds, total_pages, source, device_id, created_at',
  },
  reading_settings: {
    access: 'rw',
    purpose: 'Singleton (one row per user, key user_id): daily_minutes_goal and streak_min_minutes for reading. Confirm before changing.',
    columns: 'user_id, daily_minutes_goal, streak_min_minutes, updated_at',
  },
  // The media library is synced with Trakt both ways: migrations 117/118/120/
  // 132/136's outbox triggers queue every change to a Trakt-held fact from ANY
  // writer (this function included — it sends no x-trakt-sync header), and
  // trakt-api sends it within ~30 min. The rules say which facts those are.
  // movies / tv_series (the shared TMDB catalogue) are not in this catalog:
  // they have no user_id, so db_query can't scope them — they are read through
  // the embeds named below.
  user_movie_entries: {
    access: 'rw',
    purpose: "The user's movie library — one row per film (wanted, watching, watched, dropped). Prefer get_media for an overview.",
    columns: 'id, movie_id(uuid FK movies), status(wishlist = want to watch | watching | completed = watched | dropped | upcoming = LEGACY want-to-watch, read it as wishlist), priority(low|medium|high), rating(int 1-10 — the user\'s own; null = unrated), is_favorite(bool), personal_note(text — the user\'s own note on the film; it IS the film\'s private note on Trakt, synced both ways — Trakt keeps the first 499 characters + …), watched_at(timestamptz — when it was watched; NULL on a completed film = date unknown), repeat_count(int — extra plays: plays − 1), planned_date(date), watchlist_rank(int — Trakt watchlist order, set by the sync), created_at, updated_at. The film itself comes from the movies embed — select "*, movie:movies(title, release_date, genres, runtime, tmdb_rating, rt_critics, imdb_rating)": genres = jsonb array of {id, name}, runtime in minutes, tmdb_rating and imdb_rating /10, rt_critics/rt_audience = Rotten Tomatoes %, metacritic, letterboxd_rating /5.',
    rules: [
      '"Coming soon" is never a status: it is a wishlist (or legacy upcoming) film whose release_date is still ahead — derive it from the date. Never write status="upcoming"; use wishlist.',
      'Watched = status "completed" plus watched_at: now when they just watched it, a day they name at midday (e.g. 2026-09-12T12:00:00Z), or NULL = date unknown — ask once when it is unclear, never guess a date. Watched again = repeat_count + 1 on the same row (one row per film, never a second one).',
      'Changes to status, watched_at, repeat_count, rating, is_favorite and personal_note reach Trakt by themselves — never tell the user to change Trakt by hand. Dropped, priority and planned_date are app-only.',
      'A film that is not in the library yet can only be added in the app (Media → search, which fetches it from TMDB) — never invent a movie_id.',
    ].join(' '),
  },
  user_tv_entries: {
    access: 'rw',
    purpose: "The user's TV library — one row per show. Watched episodes are rows in user_tv_episodes. Prefer get_media for an overview.",
    columns: 'id, tv_series_id(uuid FK tv_series), status(wishlist = want to watch | watching | paused | completed | dropped), priority(low|medium|high), rating(int 1-10 — the user\'s own rating of the show), is_favorite(bool), personal_note(text — the show\'s private note on Trakt, synced both ways), started_at(timestamptz — when they started the show), finished_at(timestamptz — when they finished it), current_season/current_episode(int — a CACHE of the highest watched episode in user_tv_episodes, kept by the database; season 1 episode 0 = nothing watched), planned_date(date), watchlist_rank(int — Trakt watchlist order, set by the sync), created_at, updated_at. The show itself comes from the tv_series embed — select "*, tv_series:tv_series(title, first_air_date, last_air_date, status, number_of_seasons, number_of_episodes, genres)": status is TMDB\'s (Returning Series, Ended…), genres = jsonb array of {id, name}.',
    rules: [
      'NEVER write current_season/current_episode — they follow user_tv_episodes automatically. Record progress by marking episodes (mark_episode_watched, or user_tv_episodes rows).',
      '"Coming soon" is never a status: a wishlist show whose first_air_date is still ahead.',
      'Changes to status (wishlist, dropped), rating, is_favorite and personal_note reach Trakt by themselves; paused, priority, planned_date, started_at and finished_at are app-only.',
      'A show\'s completed/watching follows its watched episodes on the next Trakt sync (completed = every aired episode watched), so status="completed" alone may not stick: mark the episodes, or point the user to Completed on the show\'s page in the app, which marks every aired episode.',
      'A show that is not in the library yet can only be added in the app — never invent a tv_series_id.',
    ].join(' '),
  },
  user_tv_episodes: {
    access: 'rw',
    purpose: 'Watched TV episodes — THE source of truth for TV progress: one row per (show, season, episode).',
    columns: 'id, tv_entry_id(uuid FK user_tv_entries), tv_series_id(uuid FK tv_series, required), season_number(int), episode_number(int), watched_at(timestamptz — set = watched; 1970-01-01T00:00:00Z = watched on an unknown date; NULL = not watched), repeat_count(int — extra plays: plays − 1), rating(int 1-10, app-only), personal_note(app-only), created_at, updated_at',
    rules: [
      'Unique on (user_id, tv_series_id, season_number, episode_number): a rewatch is repeat_count + 1, never a second row. tv_series_id is required — read it (and tv_entry_id) from the parent user_tv_entries row first.',
      'An episode already watched keeps its watched_at (its real date); change it only when the user corrects the date. A day they name is stored at midday (e.g. 2026-09-12T12:00:00Z); when they don\'t know when, store 1970-01-01T00:00:00Z — never NULL, which means not watched.',
      'watched_at, repeat_count and deleting a row (= not watched) reach Trakt by themselves.',
      'Never invent episodes: only mark the season/episode numbers the user named or that their data shows exist.',
    ].join(' '),
  },
  movie_cinema_visits: {
    access: 'rw',
    purpose: 'Cinema trips — one row per time the user saw a film at a cinema (a second trip is its own row). It records the trip only; marking the film watched is a separate user_movie_entries change.',
    columns: 'id, movie_id(uuid FK movies — the movie_id of the film\'s user_movie_entries row), watched_on(date), cinema(text), location(text — city/area), companions(text — with whom), cost(numeric ≥ 0), currency(NOK|TRY|EUR|USD — default NOK), note(text), created_at, updated_at',
    rules: 'Read movie_id from the film\'s user_movie_entries row first (select "id, movie_id, movie:movies(title)"); a film not in the library must be added in the app first. When the user gives a cost without a currency, use the country they were in (Norway NOK, Turkey TRY).',
  },
  media_follows: {
    access: 'ro',
    purpose: 'What the user follows on the Media page — a franchise (collection), studio (company), director, actor or keyword. Each follow fills a Trakt list with its films, and a daily check writes new films and trailers to media_follow_events. Following/unfollowing happens in the app (a title\'s Follow, or Media → Lists).',
    columns: 'id, kind(collection|company|director|actor|keyword), tmdb_id(int), name, trakt_list_id(bigint — the Trakt list it fills; null = not on Trakt yet), last_checked_at(timestamptz), created_at. Also known_ids/trailer_keys — long internal lists: always pass a select without them.',
  },
  media_follow_events: {
    access: 'ro',
    purpose: '"What\'s new" for the follows: a new film (kind new_title) or a new trailer (kind trailer) found by the daily check. seen_at NULL = not seen in the app yet.',
    columns: 'id, follow_id(uuid FK media_follows), kind(new_title|trailer), tmdb_id(int), title, release_date(date), video_key(text — the trailer\'s YouTube key), poster_path, seen_at(timestamptz), created_at',
  },
  projects: {
    access: 'rw',
    purpose: 'Projects (top level).',
    columns: 'id, name, description, status(active|on_hold|completed|archived), color, sort_order, created_at, updated_at',
  },
  project_phases: {
    access: 'rw',
    purpose: 'Phases within a project.',
    columns: 'id, project_id(uuid FK projects), name, description, status(pending|in_progress|done), sort_order, created_at, updated_at',
  },
  project_items: {
    access: 'rw',
    purpose: 'Items/tasks within a project phase.',
    columns: 'id, phase_id(uuid FK project_phases), project_id(uuid FK projects), title, notes, type(update|improvement|ui_request|bug|wishlist), status(open|in_progress|done|cancelled), priority(low|medium|high), sort_order, created_at, updated_at',
  },
  // athlete_profile is rw because the user directs their own training settings
  // in chat ("hedefim güç" / "ekipmanım sadece ev"). It is a SINGLETON keyed by
  // user_id (no separate id column) — see the rules below for the db_update
  // gotcha this shape causes (db_update refuses an empty filters object).
  athlete_profile: {
    access: 'rw',
    purpose: "The user's durable training profile/settings — a SINGLETON: at most ONE row per user, keyed by user_id (there is no id column, unlike every other table here). Not a list. Consult before giving any training/programming advice so recommendations match their real goal/experience/equipment; prefer the get_athlete_profile tool to read it (returns limitations too in the same call).",
    columns: 'user_id(uuid, PRIMARY KEY — not "id"), goal(the TRAINING FOCUS: strength|hypertrophy|general; a legacy fat_loss value means general — never write fat_loss), experience_level(novice|intermediate|advanced), training_age_years(numeric, nullable), training_days_per_week(int, nullable), equipment_access(home|gym|both), notes(text, nullable), birth_year(smallint, nullable), sex(male|female, nullable), height_cm(numeric, nullable), goal_weight_kg/goal_body_fat_pct/goal_muscle_mass_kg/phase_start_date (SUPERSEDED since migration 113 — the app no longer reads them; read and write these on day_targets instead), updated_at',
    rules: [
      'There is at most one row for this user — never insert a second one once a row exists.',
      'To write: first db_query this table with filters={} to check whether a row already exists (or call get_athlete_profile). If none exists, db_insert one. If one exists, db_update it — but db_update refuses an empty filters object, so pass filters={"user_id":"<the user_id value from the row you just queried>"} to satisfy that check; every row already carries its own user_id in the query result, and it is always the correct value since every read/write here is scoped to you anyway.',
      'This table has no id column, so a db_insert response\'s id/ids fields will read null for it — check success/rows instead to confirm the write went through.',
      'Only change goal/experience_level/equipment_access when the user actually states a change; do not infer a new goal from one offhand remark.',
      'The user\'s GOAL is not here: the cut/maintain/gain phase, its start date, the daily calorie/protein/water targets and the body targets (goal weight, body fat %, muscle mass) all live on day_targets — one row, one goal. A request to lose fat or gain weight is a phase change on day_targets, not a training-focus change here.',
    ].join(' '),
  },
  // day_targets is THE goal (migrations 086 + 113): one row per user holding the
  // phase, its start date, the daily targets and the body targets — the same row
  // the app's one "Your goal" editor saves (Food, Daily and Health all show it).
  day_targets: {
    access: 'rw',
    purpose: "The user's goal — a SINGLETON: at most ONE row per user, keyed by user_id (no id column). Holds the phase (goal: cut|maintain|gain) and the day it started, the daily calorie/protein/water targets, and the body targets (goal weight, body fat %, muscle mass — one set for every phase). Read it for any question about their goal, targets, deficit plan or progress toward a goal weight.",
    columns: 'user_id(uuid, PRIMARY KEY — not "id"), calories(int kcal/day), protein_g(int g/day), water_ml(int ml/day), goal(the PHASE: cut|maintain|gain), last_calorie_adjust(date, nullable — last adaptive-calorie nudge, gates a 14-day cooldown), phase_start_date(date, nullable — first day of the current phase), goal_weight_kg(numeric 25–300, nullable), goal_body_fat_pct(numeric 3–60 — as the smart scale reports it, nullable), goal_muscle_mass_kg(numeric 10–150 — the scale report muscle % × weight, not lean mass, nullable), updated_at',
    rules: [
      'There is at most one row for this user — never insert a second one once a row exists.',
      'To write: first db_query this table with filters={} to check whether a row exists. If none exists, db_insert one. If one exists, db_update it with filters={"user_id":"<the user_id value from the row you just queried>"} (db_update refuses an empty filters object).',
      'This table has no id column, so a db_insert response\'s id/ids fields read null for it — check success/rows instead.',
      'Always say which values you will change and get an explicit yes before writing. When the phase changes, also set phase_start_date to the day the user says the new phase started (today if they don\'t say).',
      'A calorie target is a plan, never a verdict on what they ate; never lower calories below max(1500, 24 × bodyweight kg).',
    ].join(' '),
  },
  // athlete_limitations is rw for the same reason — a normal list table, not a
  // singleton. severity is never auto-escalated; that stays a conversation with
  // the user (see rules). This is structured settings data the user directs, not
  // a "note" — it does NOT join the dev_requests/ai_memory/shop_items/wish_items
  // four-way "remember this" tie-break documented on wish_items above.
  athlete_limitations: {
    access: 'rw',
    purpose: 'A normal list table — one row per movement-pattern limitation the user has (an injury, a mobility restriction, an exercise to avoid), active or past. Consult before recommending exercises, programming changes or substitutions; prefer get_athlete_profile, which returns the active list alongside the profile in one call.',
    columns: 'id, movement_pattern(text — a short movement-pattern label, e.g. overhead_press, heavy_hip_hinge, horizontal_pull — not a muscle name), severity(avoid|limit|monitor — default monitor), note(text, nullable), active(bool, default true), created_at, updated_at',
    rules: [
      'severity="avoid" means never recommend that movement pattern as a substitute or a new exercise. severity="limit" means reduce load/volume, don\'t ban it outright. severity="monitor" means just be aware — don\'t restrict anything automatically.',
      'Never auto-escalate a limitation\'s severity (e.g. monitor→avoid) on your own — that judgment call stays a conversation with the user; only change it when they say so.',
      'To retire a limitation that no longer applies, db_update active=false rather than deleting it, unless the user explicitly asks you to delete it outright.',
    ].join(' '),
  },
  // ── read-only (synced from external systems — write at the source, not here) ──
  hevy_workouts: {
    access: 'ro',
    purpose: 'Completed Hevy strength workouts (synced from Hevy). For detail use embedded select: "title, start_time, hevy_workout_exercises(title, hevy_sets(weight_kg, reps, type))".',
    columns: 'id, title, routine_id, start_time, end_time, hevy_created_at, hevy_updated_at',
  },
  hevy_routines: {
    access: 'ro',
    purpose: 'Hevy routines/templates. Embedded detail: "title, hevy_routine_exercises(title, hevy_routine_sets(weight_kg, reps, rep_range_start, rep_range_end))".',
    columns: 'id, folder_id, title, notes, hevy_created_at, hevy_updated_at',
  },
  hevy_routine_exercises: {
    access: 'ro',
    purpose: 'One row per exercise slot inside a Hevy routine (hevy_routines.id via hevy_routine_id). Prefer querying hevy_routines with the embedded select above; use this directly (or in a run_read_query JOIN) when you need to filter/join on exercise_template_id.',
    columns: 'id, hevy_routine_id(FK hevy_routines.id), exercise_template_id, index, title, notes, rest_seconds, supersets_id, created_at',
  },
  hevy_routine_sets: {
    access: 'ro',
    purpose: 'One row per planned set inside a routine exercise (hevy_routine_exercises.id via hevy_routine_exercise_id).',
    columns: 'id, hevy_routine_exercise_id(FK hevy_routine_exercises.id), index, type(normal|warmup|dropset|failure), weight_kg, reps, rep_range_start, rep_range_end, distance_meters, duration_seconds, rpe, custom_metric, created_at',
  },
  hevy_exercise_templates: {
    access: 'ro',
    purpose: 'Hevy exercise catalog (names + muscle groups).',
    columns: 'id, title, type, primary_muscle_group, is_custom',
  },
  hevy_body_measurements: {
    access: 'ro',
    purpose: 'Body measurements synced from Hevy (bodyweight, fat %, circumferences).',
    columns: 'id, date, weight_kg, lean_mass_kg, fat_percent (+ circumference columns); unique per (user_id, date)',
  },
  // ro, not rw: rows are imported by phone-gateway's import_body_composition
  // action from a validated, internally-consistent OCR read (see its own
  // cross-field checks) — the AI writing here directly could insert a
  // plausible-looking but inconsistent row with none of those guarantees.
  // A separate source from hevy_body_measurements/health_metrics (a smart-
  // scale report, not Hevy or Health Auto Export) — never join or conflate.
  body_composition_reports: {
    access: 'ro',
    purpose: 'Smart-scale "body composition analysis report" scans, imported from the phone (one row per scan). Useful for weight/body-fat/muscle trend questions alongside hevy_body_measurements and health_metrics, but a DIFFERENT source — never merge or average across sources in one answer without saying so.',
    columns: 'id, measured_at(timestamptz — the real reading instant, resolved server-side, DST-safe), weight_kg, body_fat_percent, body_fat_mass_kg, lean_body_mass_kg, body_water_percent, protein_percent, muscle_percent, skeletal_muscle_percent, skeletal_muscle_index, bmi, visceral_fat_index, subcutaneous_fat_kg, bmr_kcal, body_score(0-100, the report\'s own score), source(text, currently only \'movinglife_report\'), created_at',
  },
  strava_activities: {
    access: 'ro',
    purpose: 'Cardio activities synced from Strava.',
    columns: 'id, strava_activity_id, type(run|cycling|walk|swim|yoga|other), title, start_date, distance_meters, duration_seconds, elevation_gain_m, avg_heart_rate, avg_pace_sec_per_km, notes',
  },
  health_metrics: {
    access: 'ro',
    purpose: 'Point-in-time HealthKit samples synced via Health Auto Export (steps, energy, heart rate, sleep, body composition, nutrition, etc.) — many rows per day, one per incoming sample, not pre-aggregated. Prefer the get_health_stats tool for daily/weekly averages; query this directly only for a specific metric_name over a date range it doesn\'t cover.',
    columns: 'id, metric_name, date, recorded_at, unit, source, value(jsonb — {qty} for most metrics, {Min,Avg,Max} for heart_rate, stage fields for sleep_analysis)',
  },
  health_workouts: {
    access: 'ro',
    purpose: 'Workouts synced via Health Auto Export (Apple Health / Huawei Health) — separate source from hevy_workouts, comparable shape.',
    columns: 'id, name, start_time, end_time, duration_seconds, active_energy_kj, total_energy_kj, avg_heart_rate, min_heart_rate, max_heart_rate',
  },
  app_error_logs: {
    access: 'ro',
    purpose: 'Recent app error logs (last ~2 days). Use to help the user diagnose "why did X fail?" — the context column holds the payload/API error/route.',
    columns: 'id, message, context(jsonb — action, payload, raw API error, route, user_agent, at), created_at',
  },
  pt_assessments: {
    access: 'ro',
    purpose: "The AI PT coach's own past daily assessments (Training → Coach). Read to reference/compare earlier coaching advice; new rows are written only by the coach flow itself.",
    columns: 'id, date(date), feeling(text), note(text), snapshot(text — the training data the coach saw), assessment(text — the reply), model, created_at',
  },
  work_notes: {
    access: 'ro',
    purpose: "The user's freeform Work-page notes (the Notes card in the Work sidebar).",
    columns: 'id, content(text), updated_at',
  },
  work_weekly_goals: {
    access: 'ro',
    purpose: 'Weekly goals from the Work page (This Week card).',
    columns: 'id, week_start(date), title, done(bool), sort_order, created_at',
  },
  work_pinned_links: {
    access: 'ro',
    purpose: 'Pinned links from the Work page sidebar.',
    columns: 'id, title, url, sort_order, created_at',
  },
  // dev_requests is rw ON PURPOSE: the user treats it as the app's backlog and
  // explicitly dictates entries in chat ("bunu not al") — the AI writing a
  // well-structured row here IS the intended workflow. Same guardrails as
  // every write: announce before insert, never delete without confirmation.
  dev_requests: {
    access: 'rw',
    purpose: "The user's development backlog for THIS app (bugs/features/ideas noted for future coding sessions). When asked to 'note this down' about the app itself, insert here.",
    columns: "id, title, description, page(route e.g. /training), category(bug|feature|improvement|integration|longterm|question|other), priority(low|medium|high|urgent), status(open|in_progress|done|dismissed — default open), effort(small|medium|large, nullable), sort_order, created_at, updated_at",
    rules: 'Write title/description in the language the user used. Default status "open". Never mark done/dismissed unless the user says so.',
  },
  // ai_memory is rw: the user directs it ("bunu aklında tut") and the AI is the
  // one that both writes (save_memory / db_insert) and recalls (db_query) it.
  ai_memory: {
    access: 'rw',
    purpose: "The user's durable AI memory — notes/summaries/facts/preferences the AI was asked to remember across conversations. Prefer the save_memory tool to write; db_query here to recall (e.g. filter kind='preference', or search title/content).",
    columns: "id, kind(note|summary|fact|preference — default note), title, content, source(user|ai|auto — how it was captured), created_at, updated_at",
    rules: 'Write in the user\'s language. Only save when the user asks you to remember something or to store a conversation summary. Never delete a memory without explicit confirmation. A memory is a FACT about the user, not a plan: something to do or a place to go belongs in wish_items, a request about this app in dev_requests, something to buy in shop_items.',
  },
}

function describeDatabase(args: AnyRecord): AnyRecord {
  if (args.table) {
    const e = DB_CATALOG[args.table]
    if (!e) return { success: false, error: `Table "${args.table}" is not accessible.` }
    return { success: true, table: args.table, access: e.access, purpose: e.purpose, columns: e.columns, rules: e.rules ?? null }
  }
  const tables: AnyRecord = {}
  for (const [name, e] of Object.entries(DB_CATALOG)) tables[name] = { access: e.access, purpose: e.purpose }
  return {
    success: true,
    tables,
    note: 'Only these tables are accessible; everything else (tokens, auth, secrets) is off-limits. Every read/write is auto-scoped to you (user_id). Call describe_database with a table name for its columns, enums and rules.',
  }
}

function assertAccess(table: string, write: boolean): CatalogEntry {
  const e = DB_CATALOG[table]
  if (!e) throw new Error(`Table "${table}" is not accessible.`)
  if (write && e.access !== 'rw') throw new Error(`Table "${table}" is read-only (synced from an external system — change it at the source).`)
  return e
}

// deno-lint-ignore no-explicit-any
function parseJsonArg(raw: any, label: string): AnyRecord {
  if (raw == null || raw === '') return {}
  if (typeof raw === 'object') return raw
  try { return JSON.parse(raw) } catch { throw new Error(`Invalid JSON for ${label}: ${raw}`) }
}

// Applies a filter object to a Supabase query. Plain value = eq; null = IS NULL;
// array = IN; nested object supports gte/lte/gt/lt/neq/like/in for ranges/patterns.
function applyFilters(query: AnyRecord, filters: AnyRecord): AnyRecord {
  for (const [col, cond] of Object.entries(filters)) {
    if (cond === null) { query = query.is(col, null); continue }
    if (Array.isArray(cond)) { query = query.in(col, cond); continue }
    if (typeof cond === 'object') {
      for (const [op, val] of Object.entries(cond as AnyRecord)) {
        switch (op) {
          case 'gte':  query = query.gte(col, val); break
          case 'lte':  query = query.lte(col, val); break
          case 'gt':   query = query.gt(col, val); break
          case 'lt':   query = query.lt(col, val); break
          case 'neq':  query = query.neq(col, val); break
          case 'like': query = query.ilike(col, `%${val}%`); break
          case 'in':   query = query.in(col, val as unknown[]); break
          default: throw new Error(`Unknown filter operator "${op}" on column "${col}"`)
        }
      }
      continue
    }
    query = query.eq(col, cond)
  }
  return query
}

async function dbQuery(supabase: AnyRecord, userId: string, args: AnyRecord): Promise<AnyRecord> {
  try {
    assertAccess(args.table, false)
    const filters = parseJsonArg(args.filters, 'filters')
    const limit = Math.min(args.limit ?? 50, 200)
    let query = supabase.from(args.table).select(args.select || '*').eq('user_id', userId)
    query = applyFilters(query, filters)
    if (args.order_by) query = query.order(args.order_by, { ascending: args.ascending ?? false })
    query = query.limit(limit)
    const { data, error } = await query
    if (error) return { success: false, error: error.message }
    return { success: true, count: data?.length ?? 0, rows: data ?? [] }
  } catch (e) { return { success: false, error: (e as Error).message } }
}

// ─── AI instrumentation + live-SQL + memory ───────────────────────────────
// All writes here are BEST-EFFORT: the tables/RPC land in migration 064 (user
// applies tomorrow). Until then these silently no-op (a missing table resolves
// as an error result, not a throw) so a chat response is NEVER broken by them.

// One row per completed AI interaction. cached_tokens is the proof that the
// cache-aligned prefix (stable systemInstruction + tools) is actually hitting.
async function logUsage(
  supabase: AnyRecord, userId: string, surface: string | undefined,
  model: string, usage: UsageAcc,
): Promise<void> {
  if (usage.turns === 0) return
  try {
    await supabase.from('ai_usage_log').insert({
      user_id: userId, surface: surface ?? 'general', model,
      prompt_tokens: usage.prompt, cached_tokens: usage.cached,
      output_tokens: usage.output, tool_turns: usage.turns,
    })
  } catch { /* pre-migration / never break the response */ }
}

// Every data-read the AI runs — so hot queries can later be promoted to a
// hard-coded frontend query / RPC (the "on yüze çek" plan). Live-SQL rows keep
// the exact SQL text; db_query rows keep the structured args.
async function logQuery(
  supabase: AnyRecord, userId: string, surface: string | undefined,
  tool: string, table: string | null, args: AnyRecord, result: AnyRecord,
): Promise<void> {
  try {
    await supabase.from('ai_query_log').insert({
      user_id: userId, surface: surface ?? 'general', tool, table_name: table,
      sql:       tool === 'run_read_query' ? String(args.sql ?? '').slice(0, 4000) : null,
      args:      tool === 'db_query' ? args : null,
      ok:        result?.success !== false,
      row_count: typeof result?.count === 'number' ? result.count : null,
      error:     result?.success === false ? String(result.error ?? '').slice(0, 500) : null,
    })
  } catch { /* pre-migration / never break the response */ }
}

// Live read-only SQL escape hatch (explicit user opt-in only).
//
// THE SECURITY BOUNDARY IS THE DATABASE, NOT THIS TEXT GUARD (an adversarial
// review proved regex SQL-parsing is bypassable via comments/quoting). What
// actually contains this:
//   • the ai_run_read_query RPC is SECURITY INVOKER, called via a USER-JWT
//     client → RLS applies (rows scoped to the user; a service-role call would
//     bypass RLS, which is why we build a dedicated user client here);
//   • the RPC runs the query read-only (transaction_read_only) → no writes;
//   • the OAuth-token tables are already revoked from the `authenticated` role
//     (migration 044), so even if the text guard were bypassed the secrets are
//     permission-denied at the DB; result rows are hard-capped (LIMIT 500).
// The text guard below is a best-effort UX filter (clear errors, cheap block of
// obvious system-catalog probes) layered on top — it is NOT relied on for
// containment. It fails CLOSED: anything it can't vet is rejected.
async function runReadQuery(args: AnyRecord, authHeader?: string): Promise<AnyRecord> {
  try {
    if (!authHeader) return { success: false, error: 'No auth context for live query.' }
    let sql = typeof args.sql === 'string' ? args.sql.trim() : ''
    if (!sql) return { success: false, error: 'sql is required.' }

    // Strip SQL comments FIRST — otherwise every check below is bypassable by
    // hiding a table/keyword behind /* */ or -- (a real bypass the review found:
    // `FROM/**/pg_proc`). Then drop a single trailing ';'.
    sql = sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ').replace(/;\s*$/, '').trim()

    if (sql.includes(';'))   return { success: false, error: 'Only a single statement is allowed (no ";").' }
    if (/["`]/.test(sql))    return { success: false, error: 'Quoted identifiers are not allowed — reference tables by their plain lowercase names.' }
    if (!/^(select|with)\b/i.test(sql)) return { success: false, error: 'Only SELECT / WITH … SELECT queries are allowed.' }
    // Cheap explicit block of system catalogs / other schemas (the pg_ form is
    // anchored only on a leading word-boundary — a trailing \b never matched
    // pg_class/pg_proc, the review's dead-regex finding).
    if (/\bpg_/i.test(sql) || /\binformation_schema\b/i.test(sql) || /\b(auth|vault|storage|extensions)\s*\./i.test(sql)) {
      return { success: false, error: 'That query references a restricted schema/table.' }
    }

    // Best-effort: every table reference must be an allow-listed catalog table
    // (or a CTE defined IN this query). CTE names are recognised ONLY as
    // `name AS (` so a SELECT-list `expr AS alias` is not mistaken for one;
    // comma-joined FROM lists (`FROM a, b`) are covered.
    const catalog  = new Set(Object.keys(DB_CATALOG))
    const cteNames = new Set<string>()
    for (const m of sql.matchAll(/\b([a-z_][a-z0-9_]*)\s+as\s*\(/gi)) cteNames.add(m[1].toLowerCase())
    const refs = new Set<string>()
    // capture the whole FROM/JOIN table list up to the next clause keyword,
    // then split on commas and take each entry's first token (drops aliases +
    // schema qualifiers).
    for (const m of sql.matchAll(/\b(?:from|join)\s+([a-z0-9_,.\s]+?)(?=\b(?:where|group|order|limit|having|join|on|union|except|intersect|offset|fetch)\b|$)/gi)) {
      for (const part of m[1].split(',')) {
        const id = part.trim().split(/\s+/)[0].split('.')[0].toLowerCase()
        if (id && !/^\d/.test(id)) refs.add(id)
      }
    }
    for (const t of refs) {
      if (!catalog.has(t) && !cteNames.has(t)) {
        return { success: false, error: `Table "${t}" is not accessible — only allow-listed tables can be queried (call describe_database for the list).` }
      }
    }

    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false, autoRefreshToken: false } },
    )
    const { data, error } = await userClient.rpc('ai_run_read_query', { query_text: sql })
    if (error) return { success: false, error: error.message }
    const rows = Array.isArray(data) ? data : (data ?? [])
    return { success: true, count: rows.length, rows, sql }
  } catch (e) { return { success: false, error: (e as Error).message } }
}

async function saveMemory(supabase: AnyRecord, userId: string, args: AnyRecord): Promise<AnyRecord> {
  try {
    const title   = typeof args.title === 'string' ? args.title.trim() : ''
    const content = typeof args.content === 'string' ? args.content.trim() : ''
    if (!title || !content) return { success: false, error: 'title and content are required.' }
    const kind = ['note', 'summary', 'fact', 'preference'].includes(args.kind) ? args.kind : 'note'
    const { data, error } = await supabase.from('ai_memory')
      .insert({ user_id: userId, kind, title, content, source: 'ai' })
      .select('id').single()
    if (error) return { success: false, error: error.message }
    return { success: true, id: data?.id, kind }
  } catch (e) { return { success: false, error: (e as Error).message } }
}

// db_aggregate — SQL-style aggregation WITHOUT dumping rows into the LLM. Rows
// are fetched server-side (user-scoped, same as db_query) and reduced in JS;
// only the computed summary is returned. No SQL is built from user input
// (column/op are identifier/enum-validated and go into PostgREST's own
// .select(), which validates them), so there's no injection surface, and it
// doesn't depend on PostgREST's optional aggregate feature being enabled.
const AGG_OPS = new Set(['sum', 'avg', 'min', 'max', 'count'])
const AGG_IDENT = /^[a-z_][a-z0-9_]*$/i
const round2 = (n: number) => Math.round(n * 100) / 100
async function dbAggregate(supabase: AnyRecord, userId: string, args: AnyRecord): Promise<AnyRecord> {
  try {
    assertAccess(args.table, false)
    const metricList = (() => { const m = parseJsonArg(args.metrics, 'metrics'); return Array.isArray(m) ? m as AnyRecord[] : [] })()
    if (!metricList.length) return { success: false, error: 'metrics must be a non-empty JSON array of {op, column?, as?}.' }
    const groupBy: string[] = (() => { const g = args.group_by ? parseJsonArg(args.group_by, 'group_by') : []; return Array.isArray(g) ? g.filter((c: unknown): c is string => typeof c === 'string') : [] })()
    for (const c of groupBy) if (!AGG_IDENT.test(c)) return { success: false, error: `Invalid group_by column "${c}".` }
    for (const m of metricList) {
      if (!AGG_OPS.has(m.op)) return { success: false, error: `Invalid op "${m.op}" — use sum|avg|min|max|count.` }
      if (m.op !== 'count' && (typeof m.column !== 'string' || !AGG_IDENT.test(m.column))) return { success: false, error: `Metric "${m.op}" needs a valid column.` }
      if (m.column != null && (typeof m.column !== 'string' || !AGG_IDENT.test(m.column))) return { success: false, error: `Invalid column "${m.column}".` }
    }
    const filters = parseJsonArg(args.filters, 'filters')

    const cols = Array.from(new Set([...groupBy, ...metricList.map(m => m.column).filter((c: unknown): c is string => typeof c === 'string')]))
    const SCAN = 10000
    let q = supabase.from(args.table).select(cols.length ? cols.join(',') : 'user_id').eq('user_id', userId)
    q = applyFilters(q, filters)
    q = q.limit(SCAN)
    const { data, error } = await q
    if (error) return { success: false, error: error.message }
    const rows: AnyRecord[] = data ?? []

    const groups = new Map<string, AnyRecord[]>()
    for (const r of rows) {
      const key = groupBy.map(c => String(r[c] ?? '∅')).join('')
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(r)
    }
    const out: AnyRecord[] = []
    for (const grp of groups.values()) {
      const o: AnyRecord = {}
      for (const c of groupBy) o[c] = grp[0][c]
      for (const m of metricList) {
        const alias = (typeof m.as === 'string' && m.as) ? m.as : `${m.op}_${m.column ?? 'rows'}`
        if (m.op === 'count') { o[alias] = m.column ? grp.filter(r => r[m.column] != null).length : grp.length; continue }
        const nums = grp.map(r => Number(r[m.column])).filter(n => Number.isFinite(n))
        if (!nums.length) { o[alias] = null; continue }
        if (m.op === 'sum') o[alias] = round2(nums.reduce((a, b) => a + b, 0))
        else if (m.op === 'avg') o[alias] = round2(nums.reduce((a, b) => a + b, 0) / nums.length)
        else if (m.op === 'min') o[alias] = Math.min(...nums)
        else o[alias] = Math.max(...nums)
      }
      out.push(o)
    }
    return { success: true, group_count: out.length, groups: out, scanned: rows.length, truncated: rows.length >= SCAN }
  } catch (e) { return { success: false, error: (e as Error).message } }
}

// get_day_summary — one compact snapshot instead of several db_query calls.
async function getDaySummary(supabase: AnyRecord, userId: string, args: AnyRecord): Promise<AnyRecord> {
  try {
    const date = (typeof args.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(args.date)) ? args.date : new Date().toISOString().slice(0, 10)
    const [tasksR, foodR, blocksR, workoutR] = await Promise.allSettled([
      supabase.from('tasks').select('id,title,priority').eq('user_id', userId).or(`section.eq.today,due_date.eq.${date}`).neq('status', 'cancelled').neq('status', 'done'),
      supabase.from('food_log_entries').select('calories,protein_g').eq('user_id', userId).eq('date', date).eq('status', 'eaten'),
      supabase.from('time_blocks').select('title,start_time,duration_minutes').eq('user_id', userId).eq('date', date).order('start_time', { ascending: true }),
      supabase.from('hevy_workouts').select('id').eq('user_id', userId).gte('start_time', `${date}T00:00:00`).lte('start_time', `${date}T23:59:59`),
    ])
    const g = (r: AnyRecord): AnyRecord[] => r.status === 'fulfilled' ? (r.value.data ?? []) : []
    const food = g(foodR)
    return {
      success: true, date,
      open_task_count: g(tasksR).length,
      open_tasks: g(tasksR).map((t: AnyRecord) => ({ id: t.id, title: t.title, priority: t.priority })),
      kcal_eaten: Math.round(food.reduce((a: number, x: AnyRecord) => a + (Number(x.calories) || 0), 0)),
      protein_g_eaten: Math.round(food.reduce((a: number, x: AnyRecord) => a + (Number(x.protein_g) || 0), 0)),
      schedule: g(blocksR).map((b: AnyRecord) => ({ time: b.start_time?.slice(0, 5) ?? null, title: b.title, minutes: b.duration_minutes })),
      workout_logged: g(workoutR).length > 0,
    }
  } catch (e) { return { success: false, error: (e as Error).message } }
}

// get_athlete_profile — one compact call instead of two separate db_query
// calls before any training/programming advice. Both reads run in parallel
// and are independently tolerant of failure (e.g. migration 070 not yet
// applied), matching getDaySummary's Promise.allSettled shape above.
async function getAthleteProfile(supabase: AnyRecord, userId: string): Promise<AnyRecord> {
  try {
    const [profileR, limitationsR] = await Promise.allSettled([
      supabase.from('athlete_profile').select('*').eq('user_id', userId).maybeSingle(),
      supabase.from('athlete_limitations').select('movement_pattern,severity,note').eq('user_id', userId).eq('active', true),
    ])
    const raw = profileR.status === 'fulfilled' ? (profileR.value.data ?? null) : null
    // Read the row the way the app does: goal is the TRAINING focus (a retired
    // 'fat_loss' reads as general — the Cut phase on day_targets covers it) and
    // the four body-goal columns migration 113 superseded are left out (the
    // goal lives on day_targets now), so this call can't contradict the app.
    const profile: AnyRecord | null = raw ? { ...raw } : null
    if (profile) {
      for (const k of ['goal_weight_kg', 'goal_body_fat_pct', 'goal_muscle_mass_kg', 'phase_start_date']) delete profile[k]
      if (profile.goal === 'fat_loss') profile.goal = 'general'
    }
    const limitations = limitationsR.status === 'fulfilled' ? (limitationsR.value.data ?? []) : []
    return { success: true, profile, limitations }
  } catch (e) { return { success: false, error: (e as Error).message } }
}

async function dbInsert(supabase: AnyRecord, userId: string, args: AnyRecord): Promise<AnyRecord> {
  try {
    const entry = assertAccess(args.table, true)
    const parsed = parseJsonArg(args.values, 'values')
    // values may be a single object OR an array of rows — insert many in ONE
    // call (avoids burning a tool-loop turn per row on bulk loads).
    const now = new Date().toISOString()
    const hasUpdatedAt = entry.columns.includes('updated_at')
    const rows = (Array.isArray(parsed) ? parsed : [parsed]).map((r: AnyRecord) => {
      const row = { ...r }
      delete row.user_id
      row.user_id = userId
      if (hasUpdatedAt) row.updated_at = now
      // A water row without its day would take the column's UTC CURRENT_DATE —
      // yesterday between 00:00 and 02:00 in Oslo (the phone sends no date).
      if (args.table === 'water_log_entries' && !row.date) row.date = homeDay(Date.now())
      return row
    })
    const { data, error } = await supabase.from(args.table).insert(rows).select()
    if (error) return { success: false, error: error.message }
    const ids = (data ?? []).map((d: AnyRecord) => d.id)
    // Keep single-insert shape (id/row) for back-compat; add bulk fields too.
    return { success: true, inserted_count: ids.length, ids, id: ids[0], rows: data }
  } catch (e) { return { success: false, error: (e as Error).message } }
}

async function dbUpdate(supabase: AnyRecord, userId: string, args: AnyRecord): Promise<AnyRecord> {
  try {
    const entry = assertAccess(args.table, true)
    const filters = parseJsonArg(args.filters, 'filters')
    if (!Object.keys(filters).length) return { success: false, error: 'Refusing to update without filters — provide at least one, e.g. {"id":"..."}.' }
    const values = parseJsonArg(args.values, 'values')
    delete values.user_id  // owner is immutable
    if (entry.columns.includes('updated_at')) values.updated_at = new Date().toISOString()
    let query = supabase.from(args.table).update(values).eq('user_id', userId)
    query = applyFilters(query, filters)
    const { data, error } = await query.select()
    if (error) return { success: false, error: error.message }
    return { success: true, updated_count: data?.length ?? 0, rows: data ?? [] }
  } catch (e) { return { success: false, error: (e as Error).message } }
}

async function dbDelete(supabase: AnyRecord, userId: string, args: AnyRecord): Promise<AnyRecord> {
  try {
    assertAccess(args.table, true)
    const filters = parseJsonArg(args.filters, 'filters')
    if (!Object.keys(filters).length) return { success: false, error: 'Refusing to delete without filters — provide at least one, e.g. {"id":"..."}.' }
    let query = supabase.from(args.table).delete().eq('user_id', userId)
    query = applyFilters(query, filters)
    const { data, error } = await query.select()
    if (error) return { success: false, error: error.message }
    return { success: true, deleted_count: data?.length ?? 0 }
  } catch (e) { return { success: false, error: (e as Error).message } }
}
