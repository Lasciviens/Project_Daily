import { format } from 'date-fns'
import { supabase } from '../../../integrations/supabase/client'

export interface Message {
  role:    'user' | 'assistant'
  content: string
}

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a personal productivity assistant for Lasci's Board — a private dashboard for daily planning, tasks, recipes, shopping, media tracking, training, projects, and work.

PRIMARY CAPABILITY — generic database access. You can read and write ANY of the user's own data:
- describe_database(table?) — the schema catalog. Call this FIRST (once) whenever you're unsure which table/column to use.
- db_query(table, filters?, select?, order_by?, ascending?, limit?) — read rows.
- db_insert(table, values) — create a row (user_id is set for you; returns the new id).
- db_update(table, filters, values) — update rows matching filters (usually {"id":"..."}).
- db_delete(table, filters) — delete rows matching filters.
filters/values are JSON. filters: plain value = equals, null = IS NULL, array = IN, or {"gte":...,"lte":...,"gt":...,"lt":...,"neq":...,"like":...} for ranges/patterns.
Every operation is auto-scoped to the user; only allow-listed tables are reachable (token/secret/auth tables are private and will error). Externally-synced tables (hevy_*, strava_activities, health_daily_stats, movies, tv_series) are READ-ONLY.

SPECIAL-PURPOSE tools (use instead of the generic ones when they apply):
- get_calendar_events — Google Calendar (external API, not a table).
- get_next_transit — next public-transit departures from a stop (saved by name, or ANY stop by exact id). Use only for "when's the next bus/tram from X" — not for routing between two places.
- plan_trip — point-to-point transit routing WITH transfers (external API, EnTur journey planner). Use for anything involving getting from one place to another: "eve nasıl giderim", "X'ten Y'ye nasıl giderim", "110 sonra 23'e aktarma var mı", "18:00'de orada olmam için ne zaman çıkmalıyım".
- get_saved_transit — lists the user's saved stops/routes with their labels (e.g. which one is "Home"). Read-only, no side effects.
- search_transit_stops — free-text search for ANY stop/address (not just saved ones), returns exact ids.
- save_transit_stop / save_transit_route — save a stop/route (found via search_transit_stops) as a labeled favorite, e.g. "bu durağı Ev olarak kaydet". Only ever save ids/names that came from search_transit_stops or get_saved_transit, never invented ones.
- See TRANSIT ROUTING RULES below — transit answers going wrong has been a recurring, explicitly-flagged pain point for this user. Read them before using any transit tool.
- get_health_stats — health stats with weekly averages (nicer than raw db_query).
- get_media / plan_media / mark_episode_watched — media library + planning-with-schedule + episode progress logic.
- Shop: get_shop_categories, create_shop_category, create_shop_item, ask_clarifying_question — for shopping-wishlist flows (2-level category tree; ask before inventing a category).

TRANSIT ROUTING RULES — this has caused real problems before, follow exactly:
- ALWAYS call plan_trip for any routing/transfer/"how do I get there"/"when should I leave" question. NEVER answer from memory, NEVER invent a stop name, line number, transfer point, or time — only report exactly what a tool actually returned.
- "home"/"ev"/"eve" and "work"/"iş"/"işe" resolve automatically against the user's OWN saved transit stop/route labels — just pass them through as-is in from/to, don't translate or substitute a guessed place name yourself.
- You have room to investigate before committing to an answer — this is encouraged, not just tolerated. If you're at all unsure what "home"/"work"/an ambiguous saved-sounding place will resolve to, or there could be more than one plausible match, call get_saved_transit and/or search_transit_stops FIRST, inspect the candidates, then pass the exact id you found into plan_trip/get_next_transit instead of hoping the fuzzy match guesses right. Calling one extra tool to verify is always better than a wrong or unhelpful answer.
- If plan_trip/get_next_transit returns success:false (place not resolved, no trips found, invalid id, etc.), don't just give up or guess — try search_transit_stops for the place in question and retry with the exact id you find. Only tell the user you can't resolve it (and what they can do — save that stop in the Transit widget, or give a more specific place name) after that's genuinely failed too. Never fabricate a plausible-sounding route to avoid an unhelpful answer.
- When narrating a trip, list the legs in order with their line numbers and the exact stop names/times returned — if there's a transfer, name the stop where it happens. Don't add, remove, or reorder a leg that wasn't in the result.
- If multiple trip options are returned, lead with the first (fastest) one; only mention an alternative if it's meaningfully different (e.g. notably shorter walk, or the user asked for options).

Workflow rules:
- Unsure which table or column? Call describe_database first — do not guess column names.
- Refer to a row by name? db_query for its id first, then update/delete by that id.
- Training: read from hevy_workouts / hevy_routines / hevy_body_measurements / strava_activities (read-only). A PLANNED training session is a time_blocks row with category="training".
- Recipes vs Shop: a food recipe/dish (ingredients + how to prepare it) ALWAYS goes in the recipes table (+ recipe_ingredients), NEVER in shop_items — a recipe is not a purchase. Store recipe title/ingredients/instructions in Turkish (translate if needed).
- Deleting a task: also db_delete its linked time_blocks (source_type="task", source_id=<task id>).
- Respect enums and rules in the catalog (they're enforced by the DB and will error if violated).
- DELETES ALWAYS NEED CONFIRMATION FIRST. Never call db_delete (or delete via any tool) unless the user has, in a previous message, explicitly approved this specific deletion. If they ask to delete something, first tell them exactly what would be deleted and ask them to confirm — then stop and wait. Only delete after they say yes.
- Announce before you act. Before any create/update/delete, briefly state in your reply what you are about to do ("Şunu şunu yapacağım: …"). For creates/updates you may then proceed in the same turn; for deletes you must wait for approval as above.
- If no tool/table fits the request, say so in plain text — never force it into the closest option (e.g. do NOT save a recipe as a shop item).
- Proof of writes: db_insert/db_update/db_delete return {success, id/row/updated_count/deleted_count} or {success:false, error}. Always confirm using the ACTUAL result — cite the returned id (e.g. "Kaydedildi ✓ — ID: <id>") on success, or the real error on failure. Never claim success without it.
- Confirm actions concisely. Respond in the same language the user writes in (Turkish or English).`

// ─── Context builder ──────────────────────────────────────────────────────────

async function buildContext(): Promise<string> {
  const today = format(new Date(), 'yyyy-MM-dd')

  const results = await Promise.allSettled([
    supabase.from('tasks').select('id, title, status, priority, domain, section, description')
      .or(`section.eq.today,due_date.eq.${today}`).neq('status', 'cancelled'),
    supabase.from('tasks').select('id, title, priority, domain')
      .eq('section', 'this_week').neq('status', 'cancelled').neq('status', 'done').limit(8),
    supabase.from('tasks').select('id, title, priority')
      .eq('section', 'inbox').neq('status', 'cancelled').neq('status', 'done').limit(5),
    supabase.from('tasks').select('id, title, priority, section')
      .eq('domain', 'work').neq('status', 'cancelled').neq('status', 'done').limit(8),
    supabase.from('user_movie_entries').select('id, status, priority, movie:movies(title)')
      .in('status', ['watching', 'wishlist']).limit(10),
    supabase.from('user_tv_entries').select('id, status, current_season, current_episode, tv_series:tv_series(title)')
      .in('status', ['watching', 'paused']).limit(10),
    supabase.from('time_blocks').select('id, title, start_time, duration_minutes')
      .eq('date', today).order('start_time', { ascending: true }).limit(10),
    supabase.from('hevy_workouts').select('title, hevy_created_at, start_time, end_time')
      .order('hevy_created_at', { ascending: false }).limit(5),
  ])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const get = <T>(i: number): T[] => {
    const r = results[i]
    return r.status === 'fulfilled' ? ((r.value as { data: T[] | null }).data ?? []) : []
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const todayRaw  = get<any>(0)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const weekTasks = get<any>(1)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inbox     = get<any>(2)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const workTasks = get<any>(3)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const movies    = get<any>(4)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tv        = get<any>(5)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const schedule  = get<any>(6)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const training  = get<any>(7)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const todayTasks = Array.from(new Map(todayRaw.map((t: any) => [t.id, t])).values()) as any[]

  const lines: string[] = [`DATE: ${format(new Date(), 'EEEE, MMMM d yyyy')}`]

  if (todayTasks.length) {
    lines.push(`\nTODAY'S TASKS (${todayTasks.length}):`)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const t of todayTasks) {
      const mark = t.status === 'done' ? '[done]' : '[open]'
      lines.push(`  ${mark} [id:${t.id}] ${t.title} — ${t.priority} priority, ${t.domain}${t.description ? ` | notes: ${t.description}` : ''}`)
    }
  } else {
    lines.push("\nTODAY'S TASKS: none")
  }

  if (weekTasks.length) {
    lines.push(`\nTHIS WEEK (${weekTasks.length}):`)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const t of weekTasks) lines.push(`  [id:${t.id}] ${t.title} (${t.domain})`)
  }

  if (inbox.length) {
    lines.push(`\nINBOX (${inbox.length}):`)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const t of inbox) lines.push(`  [id:${t.id}] ${t.title}`)
  }

  if (workTasks.length) {
    lines.push(`\nWORK TASKS (${workTasks.length}):`)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const t of workTasks) lines.push(`  [id:${t.id}] ${t.title} — ${t.section}`)
  }

  if (schedule.length) {
    lines.push("\nTODAY'S SCHEDULE:")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const b of schedule) {
      const h = b.start_time ? b.start_time.slice(0, 5) : '?'
      lines.push(`  [id:${b.id}] ${h} — ${b.title} (${b.duration_minutes}min)`)
    }
  }

  if (movies.length) {
    lines.push('\nMOVIE LIBRARY:')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const m of movies) lines.push(`  [${m.status}] [entry_id:${m.id}] ${m.movie?.title}`)
  }

  if (tv.length) {
    lines.push('\nTV SERIES:')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const s of tv) lines.push(`  [${s.status}] [entry_id:${s.id}] ${s.tv_series?.title} — S${s.current_season}E${s.current_episode}`)
  }

  if (training.length) {
    lines.push('\nRECENT WORKOUTS (Hevy):')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const s of training) {
      const dur = (s.start_time && s.end_time)
        ? ` (${Math.round((new Date(s.end_time).getTime() - new Date(s.start_time).getTime()) / 60000)}min)`
        : ''
      lines.push(`  ${s.hevy_created_at?.slice(0, 10)} — ${s.title}${dur}`)
    }
  }

  return lines.join('\n')
}

// ─── Friendly error messages ──────────────────────────────────────────────────

function friendlyError(body: { error?: string; daily_limit?: number; retry_after?: number } | null, fallback: string): string {
  if (!body?.error) return fallback
  if (body.error === 'rate_limit') {
    return `Günlük AI limit doldu (${body.daily_limit ?? 20} istek/gün). Yarın sıfırlanır. Limiti kaldırmak için Google AI Studio → Billing'e kart ekle.`
  }
  if (body.error.includes('GEMINI_API_KEY')) {
    return 'AI yapılandırılmamış. Supabase Dashboard → Edge Functions → Secrets içine GEMINI_API_KEY ekle.'
  }
  if (body.error === 'Unauthorized') {
    return 'Oturum hatası — sayfayı yenile ve tekrar giriş yap.'
  }
  return body.error
}

// ─── Shared invoke ────────────────────────────────────────────────────────────

export interface AIResponse {
  text:          string
  quickReplies?: string[]
  steps?:        string[]   // activity trace of tool calls the AI ran
}

export async function invokeAI(messages: Message[], systemPrompt: string): Promise<AIResponse> {
  const { data, error } = await supabase.functions.invoke('ai-proxy', {
    body: { messages, systemPrompt },
  })

  if (error) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const body = await (error as any).context?.json?.()
      throw new Error(friendlyError(body, error.message))
    } catch (inner) {
      if (inner instanceof Error && inner !== error) throw inner
    }
    throw new Error(error.message)
  }

  if (data?.error) throw new Error(friendlyError(data, data.error))
  return data as AIResponse
}

// ─── Main send function ───────────────────────────────────────────────────────

export async function sendMessage(messages: Message[]): Promise<AIResponse> {
  const context = await buildContext()
  const systemWithContext = `${SYSTEM_PROMPT}\n\n---\nLIVE DATA:\n${context}`
  return invokeAI(messages, systemWithContext)
}

// ─── Shop-scoped send function ───────────────────────────────────────────────
//  Narrower system prompt than the general assistant — restricted to shopping
//  conversation/categorization so it never drifts into unrelated tasks/media
//  actions from the dedicated Shop-page chat panel.

const SHOP_SYSTEM_PROMPT = `You are a shopping companion for Lasci's Board — think out loud with the user
about what they're planning to buy, and organize confirmed purchases into their
wishlist. You are NOT just a form-filling bot: chat naturally. If the user is
musing ("düşünüyorum", "galiba alacağım") rather than giving a firm instruction,
respond conversationally (thoughts, questions, options) — don't force a tool
call. Only add something to the wishlist once it's clear they actually want it
tracked.

Tools: get_shop_categories, create_shop_category, create_shop_item,
ask_clarifying_question.

Categories are a STRICT 2-level tree: top category -> subcategory. Items
always attach to a SUBCATEGORY, never to a top category directly.

When the user DOES want item(s) added:
1. Call get_shop_categories first, always.
2. If an existing subcategory is a clear, confident match, call
   create_shop_item with that subcategory's ID immediately — don't ask.
3. If no subcategory is a clear match, DO NOT create one yourself. Call
   ask_clarifying_question ALONE (no other function call in that turn) with
   2-4 short tappable options — e.g. an existing top category + new
   subcategory name as one option, a brand new top category as another, plus
   whatever else looks plausible. Never make the user type a category name
   from scratch when a tap will do.
4. Once the user picks/replies, call create_shop_category (parent_id if it
   belongs under an existing top category, omitted for a new top category
   too), then create_shop_item.
5. If the user pastes/describes MULTIPLE items in one message (a whole
   basket/list), extract all of them. Add every item that has a confident
   category match right away. For the ones that don't, batch them into ONE
   ask_clarifying_question covering all of them, rather than one question per
   item.
6. Extract any details the user mentions (platform, URL, priority, region
   TR/NO, planned date) into the item — don't ask about fields the user
   didn't mention. Never set a price yourself — there is no price parameter
   on create_shop_item; if the user mentions a price, just repeat it back in
   your confirmation text so they remember to enter it manually in the app.
7. After creating something, confirm concisely: what was added and where.
   Every create_shop_item/create_shop_category call returns { success, item_id
   or category_id } or { success: false, error }. Always base your confirmation
   on that actual result — cite the ID on success, report the real error
   message on failure. Never claim something was added without it.

Respond in the same language the user writes in (Turkish or English).`

export async function sendShopMessage(messages: Message[]): Promise<AIResponse> {
  return invokeAI(messages, SHOP_SYSTEM_PROMPT)
}

// ─── Structured extraction (recipes) ──────────────────────────────────────
//  Single-shot "read this, return JSON" calls — no chat loop, no tools.
//  Reuses the same edge function; passing `responseSchema` routes ai-proxy
//  into callGeminiStructured instead of the conversational tool-calling path.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function invokeStructured<T>(prompt: string, responseSchema: any): Promise<T> {
  const { data, error } = await supabase.functions.invoke('ai-proxy', {
    body: { messages: [{ role: 'user', content: prompt }], responseSchema },
  })

  if (error) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const body = await (error as any).context?.json?.()
      throw new Error(friendlyError(body, error.message))
    } catch (inner) {
      if (inner instanceof Error && inner !== error) throw inner
    }
    throw new Error(error.message)
  }
  if (data?.error) throw new Error(friendlyError(data, data.error))
  return data.data as T
}

export interface ParsedRecipeIngredient {
  name:     string
  quantity: number | null
  unit:     string | null
  note:     string | null
}

export interface ParsedRecipe {
  title:          string
  servings:       number
  instructions:   string | null
  ingredients:    ParsedRecipeIngredient[]
  macro_estimate: {
    calories:  number | null
    protein_g: number | null
    carbs_g:   number | null
    fat_g:     number | null
    sugar_g:   number | null
  } | null
}

const RECIPE_PARSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    title:        { type: 'STRING' },
    servings:     { type: 'NUMBER' },
    instructions: { type: 'STRING', description: 'One step per line, plain text' },
    ingredients: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name:     { type: 'STRING' },
          quantity: { type: 'NUMBER', description: 'Omit if "to taste" or unspecified' },
          unit:     { type: 'STRING' },
          note:     { type: 'STRING' },
        },
        required: ['name'],
      },
    },
    macro_estimate: {
      type: 'OBJECT',
      description: 'Your best rough estimate PER SERVING, using the servings count above',
      properties: {
        calories:  { type: 'NUMBER' },
        protein_g: { type: 'NUMBER' },
        carbs_g:   { type: 'NUMBER' },
        fat_g:     { type: 'NUMBER' },
        sugar_g:   { type: 'NUMBER' },
      },
    },
  },
  required: ['title', 'servings', 'ingredients'],
}

const RECIPE_PARSE_PROMPT = `Extract structured recipe data from the text below. Identify the title,
base serving count, ingredients (name/quantity/unit/note — split combined lines like "2 cups flour" into quantity=2, unit="cups", name="flour"), instructions (one step per line), and give your best rough per-serving macro estimate (calories/protein/carbs/fat/sugar) based on the ingredients and servings. If the text isn't a recipe, do your best guess anyway — never refuse.

IMPORTANT: Always output the title, ingredient names/notes, and instructions in TURKISH — translate them if the source text is in any other language. Never leave any of it in the original language.`

export async function parseRecipeText(text: string): Promise<ParsedRecipe> {
  return invokeStructured<ParsedRecipe>(`${RECIPE_PARSE_PROMPT}\n\n---\n${text}`, RECIPE_PARSE_SCHEMA)
}

// Fetches a recipe page's readable text server-side (ai-proxy does the fetch
// — the browser can't hit arbitrary third-party origins due to CORS) and
// parses it the same way as pasted text, always translating to Turkish.
export async function fetchUrlText(url: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke('ai-proxy', {
    body: { fetchUrl: url },
  })
  if (error) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const body = await (error as any).context?.json?.()
      throw new Error(friendlyError(body, error.message))
    } catch (inner) {
      if (inner instanceof Error && inner !== error) throw inner
    }
    throw new Error(error.message)
  }
  if (data?.error) throw new Error(friendlyError(data, data.error))
  return data.text as string
}

export async function parseRecipeFromUrl(url: string): Promise<ParsedRecipe> {
  const pageText = await fetchUrlText(url)
  return parseRecipeText(pageText)
}

export interface MacroEstimate {
  calories:  number | null
  protein_g: number | null
  carbs_g:   number | null
  fat_g:     number | null
  sugar_g:   number | null
}

const MACRO_ESTIMATE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    calories:  { type: 'NUMBER' },
    protein_g: { type: 'NUMBER' },
    carbs_g:   { type: 'NUMBER' },
    fat_g:     { type: 'NUMBER' },
    sugar_g:   { type: 'NUMBER' },
  },
  required: ['calories', 'protein_g', 'carbs_g', 'fat_g', 'sugar_g'],
}

export async function estimateRecipeMacros(
  ingredients: { name: string; quantity: number | null; unit: string | null }[],
  servings: number,
): Promise<MacroEstimate> {
  const list = ingredients
    .filter(i => i.name.trim())
    .map(i => `- ${i.quantity ?? ''} ${i.unit ?? ''} ${i.name}`.trim())
    .join('\n')
  const prompt = `Estimate the PER-SERVING macros (calories, protein_g, carbs_g, fat_g, sugar_g) for a recipe with ${servings} serving(s) made from these ingredients:\n${list}\n\nGive your best rough estimate — never refuse, round to sensible whole/half numbers.`
  return invokeStructured<MacroEstimate>(prompt, MACRO_ESTIMATE_SCHEMA)
}
