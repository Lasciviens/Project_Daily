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

interface Message { role: 'user' | 'assistant'; content: string }

// deno-lint-ignore no-explicit-any
type AnyRecord = Record<string, any>

// Blocks the obvious SSRF targets (localhost/loopback/link-local/private
// ranges) — this fetches whatever URL the user pastes, server-side.
function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase()
  if (h === 'localhost' || h === '0.0.0.0' || h === '::1') return true
  if (/^127\./.test(h))                    return true
  if (/^10\./.test(h))                     return true
  if (/^192\.168\./.test(h))               return true
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true
  if (/^169\.254\./.test(h))               return true
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
  let url: URL
  try { url = new URL(rawUrl) } catch { throw new Error('Invalid URL') }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Invalid URL')
  if (isPrivateHost(url.hostname)) throw new Error('URL not allowed')

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)
  try {
    const res = await fetch(url.toString(), {
      signal:  controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LascisBoardRecipeBot/1.0)' },
    })
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
        description: 'Insert a new row into a writable table. user_id is set automatically; do not include it. Returns the created row (with its id). Use describe_database to learn required columns, enums, and business rules first.',
        parameters: {
          type: 'OBJECT',
          properties: {
            table:  { type: 'STRING', description: 'Table name (must be writable in the catalog).' },
            values: { type: 'STRING', description: 'JSON object of column→value for the new row. E.g. {"title":"...","date":"2026-07-05","category":"training"}.' },
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
        description: 'Delete rows matching filters from a writable table. Automatically scoped to the current user. Filters are required and must be non-empty. When deleting a task, also delete its linked time_blocks (source_type="task", source_id=<task id>).',
        parameters: {
          type: 'OBJECT',
          properties: {
            table:   { type: 'STRING', description: 'Table name (must be writable in the catalog).' },
            filters: { type: 'STRING', description: 'JSON object identifying rows to delete, e.g. {"id":"..."}. Required and must be non-empty.' },
          },
          required: ['table', 'filters'],
        },
      },
      // ─── Media (kept — non-trivial multi-step logic) ──────────────────────
      {
        name: 'get_media',
        description: 'Get the user\'s media library (movies and TV series). Use entry IDs with plan_media.',
        parameters: {
          type: 'OBJECT',
          properties: {
            type: { type: 'STRING', enum: ['movie', 'tv', 'both'], description: 'Default: both' },
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
        description: 'Read recent daily health stats (steps, calories, heart rate, exercise minutes) with weekly averages. Use to answer fitness questions.',
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
        description: 'Mark a TV episode as watched and advance the series progress. Use get_media first to get the entry_id.',
        parameters: {
          type: 'OBJECT',
          properties: {
            entry_id: { type: 'STRING', description: 'user_tv_entries.id from get_media' },
            season:   { type: 'NUMBER', description: 'Season number watched (optional — defaults to current)' },
            episode:  { type: 'NUMBER', description: 'Episode number watched (optional — defaults to current+1)' },
            rating:   { type: 'NUMBER', description: '1–10 personal rating (optional)' },
            note:     { type: 'STRING', description: 'Personal note about the episode (optional)' },
          },
          required: ['entry_id'],
        },
      },
      {
        name: 'get_shop_categories',
        description: 'List all shopping-wishlist categories (top categories and their subcategories). ALWAYS call this before create_shop_category or create_shop_item to check for an existing matching subcategory.',
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
        description: 'Add a wishlist item to a shopping subcategory. category_id MUST be a subcategory ID (one that itself has a parent) from get_shop_categories or a just-created create_shop_category result — never a top-category ID. Never invent a price — there is no price field here; price is manual-entry only in the app UI.',
        parameters: {
          type: 'OBJECT',
          properties: {
            category_id:  { type: 'STRING', description: 'Subcategory ID' },
            title:        { type: 'STRING' },
            notes:        { type: 'STRING' },
            platform:     { type: 'STRING', description: 'e.g. PS5, PC, iOS (optional)' },
            url:          { type: 'STRING' },
            priority:     { type: 'STRING', enum: ['low', 'medium', 'high'] },
            region:       { type: 'STRING', enum: ['TR', 'NO'], description: 'Which country this purchase relates to (optional)' },
            planned_date: { type: 'STRING', description: 'YYYY-MM-DD — when the user plans to buy this (optional)' },
          },
          required: ['category_id', 'title'],
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
        name: 'get_next_transit',
        description: 'Get the next departures from a saved transit stop. Use to answer "when is the next bus/tram?"',
        parameters: {
          type: 'OBJECT',
          properties: {
            stop_name: { type: 'STRING', description: 'Partial name of saved stop (optional — uses default stop if omitted)' },
            count:     { type: 'NUMBER', description: 'Number of departures to return (default 5)' },
          },
          required: [],
        },
      },
    ],
  },
]

Deno.serve(async (req) => {
  const origin  = req.headers.get('origin')
  const headers = corsHeaders(origin)

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers })

  const authHeader = req.headers.get('authorization')
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...headers, 'Content-Type': 'application/json' },
    })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { data: { user }, error: authError } = await supabase.auth.getUser(
    authHeader.replace('Bearer ', '')
  )
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...headers, 'Content-Type': 'application/json' },
    })
  }

  try {
    const body = await req.json() as
      { messages?: Message[]; systemPrompt?: string; responseSchema?: AnyRecord; fetchUrl?: string }

    // Fetch-and-extract-text is a distinct, lightweight action (no Gemini
    // call) — used to pull a recipe page's readable text server-side, since
    // the browser can't fetch arbitrary third-party URLs due to CORS.
    if (body.fetchUrl) {
      const text = await fetchPageText(body.fetchUrl)
      return new Response(JSON.stringify({ text }), {
        status: 200, headers: { ...headers, 'Content-Type': 'application/json' },
      })
    }

    const { messages, systemPrompt, responseSchema } = body
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

    // Structured single-shot extraction (no tool-calling loop) — used for
    // things like parsing pasted recipe text into a JSON shape.
    const result = responseSchema
      ? await callGeminiStructured(GEMINI_KEY, messages, systemPrompt, responseSchema)
      : await callGemini(GEMINI_KEY, messages, systemPrompt, supabase, user.id)
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

async function callGemini(
  apiKey: string,
  messages: Message[],
  systemPrompt: string | undefined,
  // deno-lint-ignore no-explicit-any
  supabase: any,
  userId: string,
): Promise<{ text: string; quickReplies?: string[]; steps?: string[] }> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`

  let contents: AnyRecord[] = messages.map(m => ({
    role:  m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }))

  // Descriptions of each tool call performed — surfaced to the client as an
  // activity trace (shown behind a "Show detail" link, not spoken inline).
  const steps: string[] = []

  // thinking_level MINIMAL keeps latency low while satisfying the thought_signature requirement
  const baseBody: AnyRecord = {
    tools: TOOLS,
    generationConfig: { thinking_config: { thinking_level: 'MINIMAL' } },
  }
  if (systemPrompt) {
    baseBody.systemInstruction = { parts: [{ text: systemPrompt }] }
  }

  // Multi-turn function calling loop
  for (let turn = 0; turn < 12; turn++) {
    const res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ ...baseBody, contents }),
    })

    if (!res.ok) {
      const errText = await res.text()
      if (res.status === 429) {
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
      throw new Error(`Gemini ${res.status}: ${errText}`)
    }

    const data      = await res.json()
    const candidate = data.candidates?.[0]
    if (!candidate) return ''

    const parts: AnyRecord[] = candidate.content?.parts ?? []
    const fnCallParts = parts.filter((p: AnyRecord) => p.functionCall)

    if (fnCallParts.length === 0) {
      // No more function calls — return the text response
      return { text: parts.find((p: AnyRecord) => p.text)?.text ?? '', steps: steps.length ? steps : undefined }
    }

    // ask_clarifying_question short-circuits the loop: the "answer" has to
    // come from the human as a real next turn, not a synthesized tool
    // response, so we return immediately instead of continuing the loop.
    const clarifyCall = fnCallParts.find((p: AnyRecord) => p.functionCall.name === 'ask_clarifying_question')
    if (clarifyCall) {
      const { question, options } = clarifyCall.functionCall.args
      return { text: question, quickReplies: Array.isArray(options) ? options : [], steps: steps.length ? steps : undefined }
    }

    // Preserve candidate.content verbatim — dropping it loses the encrypted thoughtSignature
    // and Gemini 3.x will reject the next turn with a 400.
    contents = [...contents, candidate.content]

    // Dispatch all function calls in this turn (may be parallel), role must be 'tool'
    const toolResponseParts = await Promise.all(
      fnCallParts.map(async (part: AnyRecord) => {
        const { name, args } = part.functionCall
        const result = await dispatch(name, args, supabase, userId)
        steps.push(describeStep(name, args, result))
        return { functionResponse: { name, response: result } }
      })
    )
    contents = [...contents, { role: 'tool', parts: toolResponseParts }]
  }

  // Ran out of tool-loop turns — make one final, tool-free call so the model
  // actually answers (or honestly says it couldn't) instead of a canned line.
  const finalBody: AnyRecord = { ...baseBody, contents }
  delete finalBody.tools
  const finalRes = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(finalBody),
  })
  if (finalRes.ok) {
    const finalData = await finalRes.json()
    const finalText = finalData.candidates?.[0]?.content?.parts?.find((p: AnyRecord) => p.text)?.text
    if (finalText) return { text: finalText, steps: steps.length ? steps : undefined }
  }
  return { text: 'Bir sonuca varamadım — tekrar sorar mısın?', steps: steps.length ? steps : undefined }
}

// One-line description of a tool call for the client-side activity trace.
function describeStep(name: string, args: AnyRecord, result: AnyRecord): string {
  const tbl = args?.table ? ` ${args.table}` : ''
  if (result?.success === false) return `✗ ${name}${tbl} — ${result.error ?? 'error'}`
  let detail = ''
  if (result?.count !== undefined) detail = ` → ${result.count} rows`
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
): Promise<{ data: AnyRecord }> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`

  const contents: AnyRecord[] = messages.map(m => ({
    role:  m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }))

  const body: AnyRecord = {
    contents,
    generationConfig: {
      thinking_config:  { thinking_level: 'MINIMAL' },
      responseMimeType: 'application/json',
      responseSchema,
    },
  }
  if (systemPrompt) body.systemInstruction = { parts: [{ text: systemPrompt }] }

  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })

  if (!res.ok) {
    const errText = await res.text()
    if (res.status === 429) {
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
): Promise<AnyRecord> {
  switch (name) {
    case 'describe_database':    return describeDatabase(args)
    case 'db_query':             return dbQuery(supabase, userId, args)
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
    default:                     return { success: false, error: `Unknown function: ${name}` }
  }
}

async function getMedia(supabase: AnyRecord, userId: string, args: AnyRecord): Promise<AnyRecord> {
  const type = args.type ?? 'both'
  const results: AnyRecord = { success: true }

  if (type === 'movie' || type === 'both') {
    const { data } = await supabase
      .from('user_movie_entries')
      .select('id, status, movie:movies(title, tmdb_id, release_date)')
      .eq('user_id', userId)
      .in('status', ['watching', 'wishlist'])
      .limit(20)
    results.movies = (data ?? []).map((e: AnyRecord) => ({
      entry_id: e.id,
      title:    e.movie?.title,
      status:   e.status,
    }))
  }

  if (type === 'tv' || type === 'both') {
    const { data } = await supabase
      .from('user_tv_entries')
      .select('id, status, current_season, current_episode, tv_series:tv_series(title, tmdb_id)')
      .eq('user_id', userId)
      .in('status', ['watching', 'paused', 'wishlist'])
      .limit(20)
    results.tv_series = (data ?? []).map((e: AnyRecord) => ({
      entry_id:        e.id,
      title:           e.tv_series?.title,
      status:          e.status,
      current_season:  e.current_season,
      current_episode: e.current_episode,
    }))
  }

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

  // Create time block: movie=2h purple, TV=45min blue at 20:00
  const { error: blockErr } = await supabase.from('time_blocks').insert({
    user_id:          userId,
    date,
    title:            taskTitle,
    start_time:       '20:00:00',
    duration_minutes: isTV ? 45 : 120,
    color:            isTV ? 'blue' : 'purple',
    source_type:      'task',
    source_id:        task.id,
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

async function getHealthStats(supabase: AnyRecord, userId: string, args: AnyRecord): Promise<AnyRecord> {
  const days  = Math.min(args.days ?? 7, 30)
  const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10)

  const { data, error } = await supabase
    .from('health_daily_stats')
    .select('date, steps, active_calories, exercise_minutes, stand_hours, heart_rate_avg, heart_rate_resting, heart_rate_max')
    .eq('user_id', userId)
    .gte('date', since)
    .order('date', { ascending: false })

  if (error) return { success: false, error: error.message }

  const stats = data ?? []
  if (!stats.length) return { success: true, message: 'No health data found for this period', stats: [] }

  // Compute weekly averages for easy AI summarization
  const avg = (key: string) => {
    const vals = stats.filter((d: AnyRecord) => d[key] != null).map((d: AnyRecord) => d[key])
    return vals.length ? Math.round(vals.reduce((a: number, b: number) => a + b, 0) / vals.length) : null
  }

  return {
    success: true,
    period_days: days,
    averages: {
      steps:             avg('steps'),
      active_calories:   avg('active_calories'),
      exercise_minutes:  avg('exercise_minutes'),
      heart_rate_avg:    avg('heart_rate_avg'),
      heart_rate_resting: avg('heart_rate_resting'),
    },
    daily: stats,
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

  const season  = args.season  ?? entry.current_season
  const episode = args.episode ?? (entry.current_episode + 1)

  // Upsert the episode record (idempotent on re-watch)
  const { error: epErr } = await supabase
    .from('user_tv_episodes')
    .upsert({
      user_id:        userId,
      tv_entry_id:    entry.id,
      tv_series_id:   entry.tv_series_id,
      season_number:  season,
      episode_number: episode,
      watched_at:     new Date().toISOString(),
      personal_note:  args.note   ?? null,
      rating:         args.rating ?? null,
      updated_at:     new Date().toISOString(),
    }, { onConflict: 'user_id,tv_series_id,season_number,episode_number' })

  if (epErr) return { success: false, error: epErr.message }

  // Advance current progress on the entry
  const { error: updateErr } = await supabase
    .from('user_tv_entries')
    .update({
      current_season:  season,
      current_episode: episode,
      updated_at:      new Date().toISOString(),
    })
    .eq('id', entry.id)
    .eq('user_id', userId)

  if (updateErr) return { success: false, error: updateErr.message }

  return {
    success: true,
    season,
    episode,
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

async function createShopItemFn(supabase: AnyRecord, userId: string, args: AnyRecord): Promise<AnyRecord> {
  const { data, error } = await supabase
    .from('shop_items')
    .insert({
      user_id:      userId,
      category_id:  args.category_id,
      title:        args.title,
      notes:        args.notes ?? null,
      // No price field — AI never auto-writes a price (manual-entry only, per design).
      platform:     args.platform ?? null,
      url:          args.url ?? null,
      priority:     args.priority ?? 'medium',
      region:       args.region ?? null,
      planned_date: args.planned_date ?? null,
      source_type:  'ai',
    })
    .select()
    .single()

  if (error) return { success: false, error: error.message }
  return { success: true, item_id: data.id, title: data.title, category_id: data.category_id }
}

async function getNextTransit(supabase: AnyRecord, userId: string, args: AnyRecord): Promise<AnyRecord> {
  // Fetch user's saved stops
  const { data: stops, error: stopsErr } = await supabase
    .from('user_transit_stops')
    .select('stop_id, stop_name, label, is_default')
    .eq('user_id', userId)
    .order('sort_order', { ascending: true })

  if (stopsErr || !stops?.length) {
    return { success: false, error: 'No saved transit stops. Add stops in the Transit widget first.' }
  }

  // Pick stop: match by name fragment, or fall back to default / first
  const stop = args.stop_name
    ? stops.find((s: AnyRecord) =>
        s.stop_name.toLowerCase().includes(args.stop_name.toLowerCase()) ||
        (s.label ?? '').toLowerCase().includes(args.stop_name.toLowerCase())
      ) ?? stops.find((s: AnyRecord) => s.is_default) ?? stops[0]
    : stops.find((s: AnyRecord) => s.is_default) ?? stops[0]

  const count = Math.min(args.count ?? 5, 10)

  // Validate NSR stop_id format to prevent GraphQL injection
  if (!/^NSR:StopPlace:\d+$/.test(stop.stop_id)) {
    return { error: 'Invalid stop ID format' }
  }

  const query = `{
    stopPlace(id: "${stop.stop_id}") {
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
  const calls = json.data?.stopPlace?.estimatedCalls ?? []

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

  return { success: true, stop: stop.stop_name, departures }
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
    columns: 'id, title, description, domain(personal|work|media), section(inbox|today|tomorrow|this_week|backlog), status(open|in_progress|waiting|done|cancelled), priority(low|medium|high), due_date(date), due_time(time), waiting_for(text), is_focused(bool), source_type(manual|movie|tv_series|media|calendar|ai), source_id(uuid), sort_order, created_at, updated_at',
    rules: 'When deleting a task, also db_delete from time_blocks where source_type="task" and source_id=<task id> to avoid orphaned schedule blocks.',
  },
  time_blocks: {
    access: 'rw',
    purpose: 'One-off day schedule / timeline blocks for a specific date.',
    columns: 'id, date(date), title, start_time(time HH:MM:SS), duration_minutes(int), color(blue|green|orange|purple|accent|red), category(daily|training|media|games|work|projects|other), source_type(task|training_session|movie|tv_episode|project_item|calendar|manual), source_id(uuid), notes, created_at, updated_at',
    rules: 'Set category to match the block type (e.g. "training" for a planned workout) — training/media/work calendar views filter by it. To reschedule to another day, update the date column.',
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
  recipe_meal_plans: {
    access: 'rw',
    purpose: 'Weekly meal plan — one entry per (date, meal_slot).',
    columns: 'id, date(date), meal_slot(breakfast|lunch|dinner|snack), recipe_id(uuid, nullable), custom_title(text, nullable), library_ingredient_id(uuid, nullable), ingredient_quantity(numeric), ingredient_unit(text), servings(numeric>0), notes, created_at',
    rules: 'At least one of recipe_id / custom_title / library_ingredient_id must be set. Unique on (user_id, date, meal_slot): to fill an occupied slot, db_query it first then db_update the existing row.',
  },
  shop_categories: {
    access: 'rw',
    purpose: 'Shopping wishlist categories — a STRICT 2-level tree.',
    columns: 'id, name, parent_id(uuid; null=top category, set=subcategory), created_at',
    rules: 'Items attach to a SUBCATEGORY (a category whose parent_id is set), never to a top category.',
  },
  shop_items: {
    access: 'rw',
    purpose: 'Shopping wishlist items (things to BUY). A recipe is never a shop item.',
    columns: 'id, category_id(uuid FK shop_categories; must be a subcategory), title, notes, price(numeric), price_source(manual|ai_estimate), platform, url, priority(low|medium|high), region(TR|NO), planned_date(date), status(wishlist|bought|dropped), source_type(manual|ai), created_at, updated_at',
    rules: 'Do not set price yourself (leave null) — price is manual-entry only. To mark an item bought/dropped, update its status.',
  },
  user_movie_entries: {
    access: 'rw',
    purpose: "User's movie library entries. Join the movie via select \"movie:movies(title, release_date)\".",
    columns: 'id, movie_id(uuid FK movies), status(watching|wishlist|completed|dropped|upcoming), priority(low|medium|high), rating(int 1-10), personal_note, planned_date, watched_at, created_at, updated_at',
  },
  user_tv_entries: {
    access: 'rw',
    purpose: "User's TV series library entries. Join the series via select \"tv_series:tv_series(title)\".",
    columns: 'id, tv_series_id(uuid FK tv_series), status(watching|wishlist|completed|dropped|paused), priority, rating(int 1-10), personal_note, current_season(int), current_episode(int), planned_date, created_at, updated_at',
  },
  user_tv_episodes: {
    access: 'rw',
    purpose: 'Per-episode watched tracking for TV entries.',
    columns: 'id, tv_entry_id(uuid FK user_tv_entries), tv_series_id(uuid FK tv_series, required), season_number(int), episode_number(int), watched_at(timestamptz; null=planned/not watched), rating(int 1-10), personal_note, created_at, updated_at',
    rules: 'Unique on (user_id, tv_series_id, season_number, episode_number). tv_series_id is required — read it from the parent user_tv_entries row first.',
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
  strava_activities: {
    access: 'ro',
    purpose: 'Cardio activities synced from Strava.',
    columns: 'id, strava_activity_id, type(run|cycling|walk|swim|yoga|other), title, start_date, distance_meters, duration_seconds, elevation_gain_m, avg_heart_rate, avg_pace_sec_per_km, notes',
  },
  health_daily_stats: {
    access: 'ro',
    purpose: 'Daily health stats. Prefer the get_health_stats tool for weekly averages.',
    columns: 'date, steps, active_calories, exercise_minutes, stand_hours, heart_rate_avg, heart_rate_resting, heart_rate_max',
  },
  app_error_logs: {
    access: 'ro',
    purpose: 'Recent app error logs (last ~2 days). Use to help the user diagnose "why did X fail?" — the context column holds the payload/API error/route.',
    columns: 'id, message, context(jsonb — action, payload, raw API error, route, user_agent, at), created_at',
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

async function dbInsert(supabase: AnyRecord, userId: string, args: AnyRecord): Promise<AnyRecord> {
  try {
    const entry = assertAccess(args.table, true)
    const values = parseJsonArg(args.values, 'values')
    delete values.user_id
    values.user_id = userId
    if (entry.columns.includes('updated_at')) values.updated_at = new Date().toISOString()
    const { data, error } = await supabase.from(args.table).insert(values).select().single()
    if (error) return { success: false, error: error.message }
    return { success: true, id: data.id, row: data }
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
