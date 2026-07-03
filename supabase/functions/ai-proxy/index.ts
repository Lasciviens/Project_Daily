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
      {
        name: 'get_tasks',
        description: 'Fetch the user\'s tasks with their IDs. Use this before updating, completing, or deleting a task by name.',
        parameters: {
          type: 'OBJECT',
          properties: {
            section: { type: 'STRING', enum: ['today', 'tomorrow', 'this_week', 'inbox', 'backlog'] },
            domain:  { type: 'STRING', enum: ['personal', 'work', 'media'] },
            status:  { type: 'STRING', enum: ['open', 'in_progress', 'done'] },
          },
          required: [],
        },
      },
      {
        name: 'create_task',
        description: 'Create a new task. Optionally also adds it to the day timeline.',
        parameters: {
          type: 'OBJECT',
          properties: {
            title:           { type: 'STRING' },
            section:         { type: 'STRING', enum: ['today', 'tomorrow', 'this_week', 'inbox', 'backlog'] },
            priority:        { type: 'STRING', enum: ['low', 'medium', 'high'] },
            domain:          { type: 'STRING', enum: ['personal', 'work', 'media'] },
            due_date:        { type: 'STRING', description: 'YYYY-MM-DD (optional)' },
            add_to_schedule: { type: 'BOOLEAN', description: 'Also add to day timeline (optional)' },
            schedule_time:   { type: 'STRING', description: 'HH:MM:SS start time, e.g. "17:00:00" (optional)' },
          },
          required: ['title', 'section', 'priority', 'domain'],
        },
      },
      {
        name: 'update_task',
        description: 'Update an existing task by its ID. Get the ID via get_tasks first.',
        parameters: {
          type: 'OBJECT',
          properties: {
            task_id:  { type: 'STRING' },
            title:    { type: 'STRING' },
            section:  { type: 'STRING', enum: ['today', 'tomorrow', 'this_week', 'inbox', 'backlog'] },
            priority: { type: 'STRING', enum: ['low', 'medium', 'high'] },
            due_date: { type: 'STRING', description: 'YYYY-MM-DD (optional, null to clear)' },
          },
          required: ['task_id'],
        },
      },
      {
        name: 'complete_task',
        description: 'Mark a task as done by its ID.',
        parameters: {
          type: 'OBJECT',
          properties: {
            task_id: { type: 'STRING' },
          },
          required: ['task_id'],
        },
      },
      {
        name: 'delete_task',
        description: 'Permanently delete a task by its ID.',
        parameters: {
          type: 'OBJECT',
          properties: {
            task_id: { type: 'STRING' },
          },
          required: ['task_id'],
        },
      },
      {
        name: 'create_time_block',
        description: 'Add a block to the day schedule/timeline.',
        parameters: {
          type: 'OBJECT',
          properties: {
            date:             { type: 'STRING', description: 'YYYY-MM-DD' },
            title:            { type: 'STRING' },
            start_time:       { type: 'STRING', description: 'HH:MM:SS, e.g. "17:00:00"' },
            duration_minutes: { type: 'NUMBER' },
            color:            { type: 'STRING', enum: ['blue', 'green', 'orange', 'purple', 'accent', 'red'] },
          },
          required: ['date', 'title', 'start_time', 'duration_minutes'],
        },
      },
      {
        name: 'log_workout',
        description: 'Log a training/workout session. Also adds a time block to the schedule.',
        parameters: {
          type: 'OBJECT',
          properties: {
            title:            { type: 'STRING', description: 'e.g. "Morning Run", "Chest Day"' },
            type:             { type: 'STRING', enum: ['strength', 'run', 'cycling', 'walk', 'yoga', 'swim', 'other'] },
            date:             { type: 'STRING', description: 'YYYY-MM-DD (defaults to today)' },
            duration_minutes: { type: 'NUMBER' },
            distance_km:      { type: 'NUMBER', description: 'For cardio activities (optional)' },
            notes:            { type: 'STRING' },
          },
          required: ['title', 'type'],
        },
      },
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
        name: 'get_time_blocks',
        description: 'Read the day schedule/timeline for a given date. Use this to answer "what do I have today/tomorrow?"',
        parameters: {
          type: 'OBJECT',
          properties: {
            date: { type: 'STRING', description: 'YYYY-MM-DD (defaults to today)' },
          },
          required: [],
        },
      },
      {
        name: 'delete_time_block',
        description: 'Delete a time block from the day schedule by its ID. Use get_time_blocks first to find the ID.',
        parameters: {
          type: 'OBJECT',
          properties: {
            block_id: { type: 'STRING' },
          },
          required: ['block_id'],
        },
      },
      {
        name: 'get_workouts',
        description: 'Read past workout/training sessions. Use to answer questions about training history.',
        parameters: {
          type: 'OBJECT',
          properties: {
            limit: { type: 'NUMBER', description: 'Max number of sessions to return (default 10)' },
            type:  { type: 'STRING', enum: ['strength', 'run', 'cycling', 'walk', 'yoga', 'swim', 'other'], description: 'Filter by workout type (optional)' },
          },
          required: [],
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
        name: 'get_projects',
        description: 'List the user\'s active projects with their phases and items/tasks. Use to answer "what am I working on?" or before creating a project item.',
        parameters: {
          type: 'OBJECT',
          properties: {
            include_done: { type: 'BOOLEAN', description: 'Also include completed/archived projects (default false)' },
          },
          required: [],
        },
      },
      {
        name: 'create_project_item',
        description: 'Add a new item (task/bug/improvement/wishlist) to a project phase. Use get_projects first to find phase_id.',
        parameters: {
          type: 'OBJECT',
          properties: {
            phase_id:   { type: 'STRING', description: 'Phase ID from get_projects' },
            project_id: { type: 'STRING', description: 'Project ID from get_projects' },
            title:      { type: 'STRING' },
            type:       { type: 'STRING', enum: ['update', 'improvement', 'ui_request', 'bug', 'wishlist'] },
            priority:   { type: 'STRING', enum: ['low', 'medium', 'high'] },
            notes:      { type: 'STRING', description: 'Optional extra details' },
          },
          required: ['phase_id', 'project_id', 'title'],
        },
      },
      {
        name: 'get_health_stats',
        description: 'Read recent daily health stats (steps, calories, heart rate, exercise minutes). Use to answer fitness questions.',
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
        name: 'update_time_block',
        description: 'Edit an existing schedule block (change title, start time, or duration). Use get_time_blocks first to find block_id.',
        parameters: {
          type: 'OBJECT',
          properties: {
            block_id:         { type: 'STRING' },
            title:            { type: 'STRING' },
            start_time:       { type: 'STRING', description: 'HH:MM:SS' },
            duration_minutes: { type: 'NUMBER' },
            color:            { type: 'STRING', enum: ['blue', 'green', 'orange', 'purple', 'accent', 'red'] },
          },
          required: ['block_id'],
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
): Promise<{ text: string; quickReplies?: string[] }> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`

  let contents: AnyRecord[] = messages.map(m => ({
    role:  m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }))

  // thinking_level MINIMAL keeps latency low while satisfying the thought_signature requirement
  const baseBody: AnyRecord = {
    tools: TOOLS,
    generationConfig: { thinking_config: { thinking_level: 'MINIMAL' } },
  }
  if (systemPrompt) {
    baseBody.systemInstruction = { parts: [{ text: systemPrompt }] }
  }

  // Multi-turn function calling loop (max 6 iterations)
  for (let turn = 0; turn < 6; turn++) {
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
      return { text: parts.find((p: AnyRecord) => p.text)?.text ?? '' }
    }

    // ask_clarifying_question short-circuits the loop: the "answer" has to
    // come from the human as a real next turn, not a synthesized tool
    // response, so we return immediately instead of continuing the loop.
    const clarifyCall = fnCallParts.find((p: AnyRecord) => p.functionCall.name === 'ask_clarifying_question')
    if (clarifyCall) {
      const { question, options } = clarifyCall.functionCall.args
      return { text: question, quickReplies: Array.isArray(options) ? options : [] }
    }

    // Preserve candidate.content verbatim — dropping it loses the encrypted thoughtSignature
    // and Gemini 3.x will reject the next turn with a 400.
    contents = [...contents, candidate.content]

    // Dispatch all function calls in this turn (may be parallel), role must be 'tool'
    const toolResponseParts = await Promise.all(
      fnCallParts.map(async (part: AnyRecord) => {
        const { name, args } = part.functionCall
        const result = await dispatch(name, args, supabase, userId)
        return { functionResponse: { name, response: result } }
      })
    )
    contents = [...contents, { role: 'tool', parts: toolResponseParts }]
  }

  return { text: 'Done — all requested actions completed.' }
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
    case 'get_tasks':       return getTasks(supabase, userId, args)
    case 'create_task':     return createTask(supabase, userId, args)
    case 'update_task':     return updateTask(supabase, userId, args)
    case 'complete_task':   return completeTask(supabase, userId, args)
    case 'delete_task':     return deleteTaskFn(supabase, userId, args)
    case 'create_time_block': return createTimeBlock(supabase, userId, args)
    case 'log_workout':     return logWorkout(supabase, userId, args)
    case 'get_media':           return getMedia(supabase, userId, args)
    case 'plan_media':          return planMedia(supabase, userId, args)
    case 'get_time_blocks':     return getTimeBlocks(supabase, userId, args)
    case 'delete_time_block':   return deleteTimeBlock(supabase, userId, args)
    case 'get_workouts':        return getWorkouts(supabase, userId, args)
    case 'get_calendar_events':  return getCalendarEvents(supabase, userId, args)
    case 'get_projects':         return getProjects(supabase, userId, args)
    case 'create_project_item':  return createProjectItem(supabase, userId, args)
    case 'get_health_stats':     return getHealthStats(supabase, userId, args)
    case 'mark_episode_watched': return markEpisodeWatched(supabase, userId, args)
    case 'update_time_block':    return updateTimeBlock(supabase, userId, args)
    case 'get_shop_categories':  return getShopCategories(supabase, userId)
    case 'create_shop_category': return createShopCategoryFn(supabase, userId, args)
    case 'create_shop_item':     return createShopItemFn(supabase, userId, args)
    case 'get_next_transit':     return getNextTransit(supabase, userId, args)
    default:                     return { success: false, error: `Unknown function: ${name}` }
  }
}

async function getTasks(supabase: AnyRecord, userId: string, args: AnyRecord): Promise<AnyRecord> {
  let query = supabase
    .from('tasks')
    .select('id, title, status, priority, domain, section, due_date, description')
    .eq('user_id', userId)
    .neq('status', 'cancelled')
    .limit(50)

  if (args.section) query = query.eq('section', args.section)
  if (args.domain)  query = query.eq('domain',  args.domain)
  if (args.status)  query = query.eq('status',  args.status)

  const { data, error } = await query
  if (error) return { success: false, error: error.message }
  return { success: true, tasks: data ?? [] }
}

async function createTask(supabase: AnyRecord, userId: string, args: AnyRecord): Promise<AnyRecord> {
  const { data, error } = await supabase
    .from('tasks')
    .insert({
      user_id:    userId,
      title:      args.title,
      section:    args.section   ?? 'inbox',
      priority:   args.priority  ?? 'medium',
      domain:     args.domain    ?? 'personal',
      due_date:   args.due_date  ?? null,
      status:     'open',
      sort_order: 0,
      source_type: 'ai',
    })
    .select()
    .single()

  if (error) return { success: false, error: error.message }

  // Optionally add to day schedule
  if (args.add_to_schedule && args.due_date) {
    const startTime = args.schedule_time ?? '17:00:00'
    await supabase.from('time_blocks').insert({
      user_id:          userId,
      date:             args.due_date,
      title:            args.title,
      start_time:       startTime,
      duration_minutes: 60,
      color:            'accent',
      source_type:      'task',
      source_id:        data.id,
      updated_at:       new Date().toISOString(),
    })
  }

  return { success: true, task_id: data.id, title: data.title, section: data.section }
}

async function updateTask(supabase: AnyRecord, userId: string, args: AnyRecord): Promise<AnyRecord> {
  const patch: AnyRecord = {}
  if (args.title    !== undefined) patch.title    = args.title
  if (args.section  !== undefined) patch.section  = args.section
  if (args.priority !== undefined) patch.priority = args.priority
  if (args.due_date !== undefined) patch.due_date = args.due_date || null

  const { error } = await supabase
    .from('tasks')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', args.task_id)
    .eq('user_id', userId)

  if (error) return { success: false, error: error.message }
  return { success: true, task_id: args.task_id, updated: patch }
}

async function completeTask(supabase: AnyRecord, userId: string, args: AnyRecord): Promise<AnyRecord> {
  const { error } = await supabase
    .from('tasks')
    .update({ status: 'done', updated_at: new Date().toISOString() })
    .eq('id', args.task_id)
    .eq('user_id', userId)

  if (error) return { success: false, error: error.message }
  return { success: true, task_id: args.task_id, status: 'done' }
}

async function deleteTaskFn(supabase: AnyRecord, userId: string, args: AnyRecord): Promise<AnyRecord> {
  const { error } = await supabase
    .from('tasks')
    .delete()
    .eq('id', args.task_id)
    .eq('user_id', userId)

  if (error) return { success: false, error: error.message }
  return { success: true, task_id: args.task_id, deleted: true }
}

async function createTimeBlock(supabase: AnyRecord, userId: string, args: AnyRecord): Promise<AnyRecord> {
  const { data, error } = await supabase
    .from('time_blocks')
    .insert({
      user_id:          userId,
      date:             args.date,
      title:            args.title,
      start_time:       args.start_time,
      duration_minutes: args.duration_minutes,
      color:            args.color ?? 'accent',
      updated_at:       new Date().toISOString(),
    })
    .select()
    .single()

  if (error) return { success: false, error: error.message }
  return { success: true, block_id: data.id, date: data.date, start_time: data.start_time }
}

async function logWorkout(supabase: AnyRecord, userId: string, args: AnyRecord): Promise<AnyRecord> {
  const today    = new Date().toISOString().slice(0, 10)
  const date     = args.date ?? today
  const durationSec = args.duration_minutes ? args.duration_minutes * 60 : null

  const { data, error } = await supabase
    .from('training_sessions')
    .insert({
      user_id:          userId,
      planned_date:     date,
      completed_at:     new Date().toISOString(),
      type:             args.type,
      title:            args.title,
      notes:            args.notes ?? null,
      source:           'manual',
      duration_seconds: durationSec,
      distance_meters:  args.distance_km ? Math.round(args.distance_km * 1000) : null,
    })
    .select()
    .single()

  if (error) return { success: false, error: error.message }

  // Auto-create time block at 17:00 (45min, purple)
  await supabase.from('time_blocks').insert({
    user_id:          userId,
    date,
    title:            args.title,
    start_time:       '17:00:00',
    duration_minutes: args.duration_minutes ?? 45,
    color:            'purple',
    updated_at:       new Date().toISOString(),
  })

  return { success: true, session_id: data.id, title: data.title, date }
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

async function getTimeBlocks(supabase: AnyRecord, userId: string, args: AnyRecord): Promise<AnyRecord> {
  const date = args.date ?? new Date().toISOString().slice(0, 10)

  const { data, error } = await supabase
    .from('time_blocks')
    .select('id, title, start_time, duration_minutes, color, source_type')
    .eq('user_id', userId)
    .eq('date', date)
    .order('start_time', { ascending: true })

  if (error) return { success: false, error: error.message }
  return { success: true, date, blocks: data ?? [] }
}

async function deleteTimeBlock(supabase: AnyRecord, userId: string, args: AnyRecord): Promise<AnyRecord> {
  const { error } = await supabase
    .from('time_blocks')
    .delete()
    .eq('id', args.block_id)
    .eq('user_id', userId)

  if (error) return { success: false, error: error.message }
  return { success: true, block_id: args.block_id, deleted: true }
}

async function getWorkouts(supabase: AnyRecord, userId: string, args: AnyRecord): Promise<AnyRecord> {
  const limit = Math.min(args.limit ?? 10, 30)

  let query = supabase
    .from('training_sessions')
    .select('id, title, type, planned_date, completed_at, duration_seconds, distance_meters, notes')
    .eq('user_id', userId)
    .order('completed_at', { ascending: false })
    .limit(limit)

  if (args.type) query = query.eq('type', args.type)

  const { data, error } = await query
  if (error) return { success: false, error: error.message }

  const sessions = (data ?? []).map((s: AnyRecord) => ({
    id:           s.id,
    title:        s.title,
    type:         s.type,
    date:         s.planned_date,
    duration_min: s.duration_seconds ? Math.round(s.duration_seconds / 60) : null,
    distance_km:  s.distance_meters  ? (s.distance_meters / 1000).toFixed(2) : null,
    notes:        s.notes,
  }))

  return { success: true, sessions }
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

async function getProjects(supabase: AnyRecord, userId: string, args: AnyRecord): Promise<AnyRecord> {
  const statuses = args.include_done
    ? ['active', 'on_hold', 'completed', 'archived']
    : ['active', 'on_hold']

  const { data, error } = await supabase
    .from('projects')
    .select(`
      id, name, description, status, color,
      project_phases (
        id, name, status,
        project_items ( id, title, type, status, priority )
      )
    `)
    .eq('user_id', userId)
    .in('status', statuses)
    .order('sort_order', { ascending: true })

  if (error) return { success: false, error: error.message }
  return { success: true, projects: data ?? [] }
}

async function createProjectItem(supabase: AnyRecord, userId: string, args: AnyRecord): Promise<AnyRecord> {
  const { data, error } = await supabase
    .from('project_items')
    .insert({
      user_id:    userId,
      phase_id:   args.phase_id,
      project_id: args.project_id,
      title:      args.title,
      type:       args.type     ?? 'improvement',
      priority:   args.priority ?? 'medium',
      notes:      args.notes    ?? null,
      status:     'open',
      sort_order: 0,
    })
    .select()
    .single()

  if (error) return { success: false, error: error.message }
  return { success: true, item_id: data.id, title: data.title, type: data.type }
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

async function updateTimeBlock(supabase: AnyRecord, userId: string, args: AnyRecord): Promise<AnyRecord> {
  const patch: AnyRecord = { updated_at: new Date().toISOString() }
  if (args.title            !== undefined) patch.title            = args.title
  if (args.start_time       !== undefined) patch.start_time       = args.start_time
  if (args.duration_minutes !== undefined) patch.duration_minutes = args.duration_minutes
  if (args.color            !== undefined) patch.color            = args.color

  const { error } = await supabase
    .from('time_blocks')
    .update(patch)
    .eq('id', args.block_id)
    .eq('user_id', userId)

  if (error) return { success: false, error: error.message }
  return { success: true, block_id: args.block_id, updated: patch }
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
