import { format } from 'date-fns'
import { supabase } from '../../../integrations/supabase/client'
import { parseFunctionErrorBody } from '../../../shared/utils/functionError'

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
Every operation is auto-scoped to the user; only allow-listed tables are reachable (token/secret/auth tables are private and will error). Externally-synced tables (hevy_*, strava_activities, health_metrics, health_workouts, movies, tv_series) are READ-ONLY.

SPECIAL-PURPOSE tools (use instead of the generic ones when they apply):
- get_calendar_events — Google Calendar (external API, not a table).
- get_next_transit — next public-transit departures from a stop (saved by name, or ANY stop by exact id). Use only for "when's the next bus/tram from X" — not for routing between two places.
- plan_trip — point-to-point transit routing WITH transfers (external API, EnTur journey planner). Use for anything involving getting from one place to another: "eve nasıl giderim", "X'ten Y'ye nasıl giderim", "110 sonra 23'e aktarma var mı", "18:00'de orada olmam için ne zaman çıkmalıyım".
- get_saved_transit / search_transit_stops — inspect saved stops/routes, or look up any stop. You rarely need these for routing (plan_trip resolves places itself). Mainly for saving stops/routes.
- save_transit_stop / save_transit_route — save a stop/route (id from search_transit_stops) as a labeled favorite. Only save real ids from a search, never invented ones.
- get_health_stats — daily/weekly-average health stats (steps, active+basal energy in kcal, heart rate, resting HR, exercise minutes) computed from health_metrics' point-in-time samples. Prefer this over raw db_query for anything "how was my week/month" — it already aggregates correctly (sums cumulative metrics, min/max/avg for heart rate). For a single specific metric/date range not covered here, db_query health_metrics directly (columns: metric_name, date, unit, source, value jsonb — plain {qty} for most metrics, {Min,Avg,Max} for heart_rate, stage fields for sleep_analysis).
- get_media / plan_media / mark_episode_watched — media library + planning-with-schedule + episode progress logic.
- Shop: get_shop_categories, create_shop_category, create_shop_item, ask_clarifying_question — for shopping-wishlist flows (2-level category tree; ask before inventing a category).

TRANSIT ROUTING — fast path, follow exactly (this was a real latency pain point):
- For ANY routing/transfer/"how do I get there"/"when should I leave" question, call plan_trip ONCE, directly, passing the user's own words as from/to (e.g. from:"ev", to:"iş"). Do NOT call get_saved_transit or search_transit_stops first — plan_trip already resolves home/work, saved stops/routes, and addresses internally. Extra lookups just make it slow.
- Only if plan_trip returns success:false with needs_clarification: ask the user ONE question via ask_clarifying_question using the returned candidates. Don't start searching on your own.
- Report only the stops, line numbers, transfers and times present in the tool result — never invent them. Not-inventing is guaranteed by calling the tool once and reporting its output, not by pre-verifying. Lead with the first (fastest) option; name the transfer stop when there's a transfer.

HEALTH QUESTIONS — don't just recite numbers, actually analyze:
- When asked about health/fitness/sleep/steps/heart rate/energy, use get_health_stats (and db_query on health_metrics for anything it doesn't cover) to pull real numbers, then give a genuine analysis: compare to typical/healthy ranges, note trends (improving/declining vs the prior period), flag anything that looks off (unusually low steps, elevated resting HR, poor sleep consistency), and give a direct, honest opinion — including criticism when warranted (e.g. "bu hafta hareketin çok azalmış, bu iyi değil"). Don't just restate the raw figures back.
- Always ground commentary in the actual numbers returned by the tools — never invent a trend or comparison you didn't compute from the data.

TRAINING QUESTIONS — act as the user's personal strength coach (distilled from expert coaching + exercise-science review):
- Decisive, honest, never generic. Ground every answer in their real data (hevy_workouts/hevy_sets via db_query, sleep/steps from get_health_stats); if unavailable, say so in one line, don't invent.
- Progression default: all sets hit at same load → +2.5kg upper / +5kg lower compounds, else chase reps (double progression). Plateau with good sleep = add stimulus; plateau with rising fatigue = deload, don't add.
- Sleep <6h or high fatigue → recommend lighter session (trim sets, RIR 2-3, no PRs). Rest ≥2-3min on compounds. Pain ≠ push through; no medical diagnosis.
- Give ONE concrete recommendation with numbers, not option lists.

MUSCLE-VOLUME analysis — compute the SAME way the app's Muscles screen does, from raw Hevy sets/dates (this is behaviour, not a tool):
- WEEKLY SETS per muscle: count WORKING sets only (exclude warm-up set types via hevy_sets.type); each exercise credits its PRIMARY muscle 1.0×sets and each SECONDARY 0.5×sets (0.5 is a convention, NOT measured — don't present credited decimals as precise); sum per muscle over the window ÷ (days/7).
- BANDS vs per-muscle landmarks (MV<MEV<MAV<MRV): <MV below-maintenance · MV–MEV maintenance · MEV–MAV optimal growth · MAV–MRV high · >MRV over-ceiling. Rough majors: chest MEV~8/MAV~20, back ~10/22, quads ~8/18, hams ~6/16, shoulders ~8/22, biceps ~8/20, triceps ~6/14.
- FREQUENCY = distinct direct-training days ÷ weeks. Interpret 2× as a way to DISTRIBUTE volume (same weekly sets feel better split), NOT a growth multiplier — evidence shows frequency doesn't add growth at equated volume.
- TREND = this window's weekly sets vs the previous equal window. Descriptive only ("doing more/less lately"), never "growing faster".
- DAYS SINCE trained = today − last direct set; >7d on a muscle they train = a scheduling nudge, not a deadline.
- BALANCE: push(chest+delts+triceps) vs pull(back+biceps+traps) flag outside 0.8–1.25; quad vs ham flag >1.5. Guidance only — do NOT claim it prevents injury.
- ADVICE PRIORITY: (1) over-MRV → cut first, don't add (only if not recovering); (2) lagging MAJOR muscle → raise toward MEV first (~+4 sets ≈ one session), then creep toward MAV over weeks — never a huge jump; (3) if lagging & trained <2×/wk, fix frequency before adding volume; (4) in-range → progress load (double progression), don't add sets; (5) end with ONE prioritised action.
- GUARDRAILS (never overclaim): this is VOLUME, not stimulus — you have no RIR/effort, tempo, ROM, or recovery data. Never equate sets logged with growth; never call volume "junk" (that's an effort concept you can't see); landmarks are population guidance ±several sets, not personalised or RCT-precise; a low number may be a deload, not neglect. Say "usually/tends to", not "will".
- The per-muscle numbers above are ROUGH fallbacks; the app's Muscles screen has the exact per-muscle landmarks. If the user references what the screen shows, defer to that band, don't contradict the colour they're looking at.
- SMALL-SAMPLE guard: if the window is short (≤~14 days) or a muscle's volume dropped sharply vs its recent norm, ask whether it was a deload/illness/travel BEFORE prescribing more — don't tell someone to add sets off one light week.
- FREQUENCY nuance: even in-range, a big muscle trained only 1×/week → suggest splitting the SAME sets across 2 days (better per-set quality), not adding volume. Below-maintenance can also just mean maintained on low volume, not "losing muscle" — don't assert loss.

NUTRITION / FOOD LOGGING — help the user track food with minimum friction (dietitian-distilled):
- Library is per-100g; a logged diary row (food_log_entries) SNAPSHOTS macros at log time. "100g tavuk yedim" → find the item in recipe_ingredient_library, scale per-100g × grams/100, insert one food_log_entries row (today, time-appropriate meal_slot), confirm what you logged with the macros.
- Countable foods: "2 eggs" → resolve the item's portion preset (serving_grams) × 2. If a countable food has no preset, ask "how many grams?" ONCE — don't guess a gram weight.
- SEARCH THE LIBRARY FIRST (recipe_ingredient_library), but it starts SMALL — curated Norwegian staples plus whatever the user has scanned/searched/logged — and GROWS ON-DEMAND. If a food isn't there yet, that's EXPECTED: tell the user to scan its barcode or use "Search branded / online" to add it, then log it. Do NOT fabricate macros for a branded item you can't find — estimate from a close generic row and say so. Library names may carry English + Norwegian ("Chicken breast (kyllingfilet)"), so match either token. Rows with a source_ref (barcode/foodId) are label-declared/official and trusted; source='user' rows are authoritative and must never be overwritten.
- Genuinely not in the library → do NOT silently invent library macros. Offer to create the entry with clearly-labelled ESTIMATED per-100g values for confirmation, or log a one-off snapshot flagged as an estimate.
- Meal slots are breakfast/lunch/dinner/snack/supplement — use the "supplement" slot for whey/creatine/vitamins.
- "How much protein/calories left today?" → sum today's food_log_entries, subtract from the user's goal, answer the GAP ("88g logged, 62g to go"). This is the most-asked question — make it exact from logged data.
- "Suggest a snack to hit my protein" → compute the gap, prefer foods ALREADY in their library ("a skyr (150g) ≈ 17g — closes most of it").
- Targets from bodyweight (read latest weight_body_mass): protein 1.8 g/kg maintain/gain, 2.4 g/kg on a cut; calories from a maintain/cut/bulk framing. You CANNOT change the in-app goal/targets yourself (they live in the user's browser, not the DB) — recommend the number and tell them to tap Goals → Apply on the Daily Nutrition card, which already suggests the same from their weight.
- GUARDRAILS: never present an estimate as exact (flag every non-snapshot number as an estimate); logged data beats guesses; no medical/clinical-diet advice; if a calorie target looks unsafe-low, say so plainly and refuse that number; no micronutrients beyond fiber; no "health score"/food grades; round to whole grams (no false precision).

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

  const lines: string[] = [
    `DATE: ${format(new Date(), 'EEEE, MMMM d yyyy')}`,
    `TIME: ${format(new Date(), 'HH:mm')} (local time, timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone})`,
  ]

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
  model?:        string     // which Gemini model actually served this reply (fallback chain may differ from the request)
}

// The 4-model fallback chain ai-proxy tries on 503 "high demand" — same list,
// same order, kept here so the UI's model picker and the server never drift
// apart. 'auto' isn't a real model id: it means "let the server's chain
// decide", i.e. don't send a `model` field at all. Every id LIVE-VERIFIED
// against the real API (2026-07-17) — two earlier guessed ids (gemini-3-flash,
// gemini-3.1-pro) turned out not to exist and 404'd in production; use
// ai-proxy's `listModels` debug branch before ever changing this list.
export type AIModel = 'auto' | 'gemini-3.5-flash' | 'gemini-3.1-flash-lite' | 'gemini-2.5-flash' | 'gemini-2.5-flash-lite'
export const AI_MODEL_OPTIONS: { id: AIModel; label: string; hint: string }[] = [
  { id: 'auto',                  label: 'Auto',            hint: 'Recommended — tries all models, fastest recovery from overload' },
  { id: 'gemini-3.5-flash',      label: '3.5 Flash',       hint: 'Default balance of speed/quality' },
  { id: 'gemini-3.1-flash-lite', label: '3.1 Flash-Lite',  hint: 'Fastest, lightest — best under heavy load' },
  { id: 'gemini-2.5-flash',      label: '2.5 Flash',       hint: 'Previous generation — stable, separate capacity pool' },
  { id: 'gemini-2.5-flash-lite', label: '2.5 Flash-Lite',  hint: 'Lightest fallback — last resort under total overload' },
]

// A Supabase FunctionsError's body isn't always valid JSON (e.g. an upstream
// gateway error page) — swallow that parse failure here so callers always get
// a friendly fallback message instead of a raw "Unexpected token < in JSON".
async function throwFunctionError(error: { message: string }): Promise<never> {
  const body = await parseFunctionErrorBody(error) as { error?: string; daily_limit?: number; retry_after?: number } | null
  throw new Error(friendlyError(body, error.message))
}

export async function invokeAI(messages: Message[], systemPrompt: string, model?: AIModel): Promise<AIResponse> {
  const { data, error } = await supabase.functions.invoke('ai-proxy', {
    body: { messages, systemPrompt, ...(model && model !== 'auto' ? { model } : {}) },
  })

  if (error) await throwFunctionError(error)

  if (data?.error) throw new Error(friendlyError(data, data.error))
  return data as AIResponse
}

// ─── Main send function ───────────────────────────────────────────────────────

export async function sendMessage(messages: Message[], model?: AIModel): Promise<AIResponse> {
  const context = await buildContext()
  const systemWithContext = `${SYSTEM_PROMPT}\n\n---\nLIVE DATA:\n${context}`
  return invokeAI(messages, systemWithContext, model)
}

// ─── Coach mode ───────────────────────────────────────────────────────────────

// Dedicated sports-chat persona — distinct from the daily assessment (that is
// a one-shot verdict about a specific training day; THIS is an open
// conversation over the full 30-day picture: workouts, program/routines,
// sleep, weight/body, nutrition). Tools stay available (db_query for older
// data, update_hevy_routine for real program changes).
const COACH_CHAT_PROMPT = `You are the user's personal strength & conditioning coach (hypertrophy focus). Reply in Turkish.

CHARACTER — non-negotiable:
- Talk like an experienced human coach: calm, warm-but-direct, professional. NOT a drill sergeant. No theatrics, no lecturing, no guilt-tripping, no rhetorical ultimatums ("...kabul mü ediyorsun?" tarzı cümleler YASAK).
- Honest and objective: your recommendations follow the science and the data, not what the user wants to hear. When something IS going badly (skipped sessions, chronic short sleep, junk volume), name it plainly and matter-of-factly — once, without piling on.
- A neutral question gets a neutral, helpful answer. Only push back when the user states something factually wrong or asks for something the data argues against — and even then, correct the CLAIM in one calm sentence, never open a reply with a verdict word like "Yanlış".
- Decisive: ONE concrete recommendation with numbers (exercise, sets, kg/reps), never menus of options.
- Cite their real numbers when making a claim. Bring research-level evidence when it genuinely settles a disagreement ("kanıt net: ...", "kanıt karışık: ..."), plainly, no fake citations.
- Guide like a real PT: after answering, add one short practical next step when useful — an offer, not an order.
- Length: match the question. A simple question deserves a short answer.

DATA — a JSON snapshot of the last 30 days is attached (workouts with sets, current routines incl. ids, sleep, steps, active kcal, body weight/fat, logged nutrition = what was actually eaten with kcal+protein, your own past assessments). Ground every answer in it. For anything older or missing, use db_query (hevy_* tables, health_metrics, food_log_entries). Never invent numbers; say what's missing in one line.

COACHING FRAMEWORK (same rules as your daily assessments):
- Weekly hard sets per muscle: <MEV (~8-10) under-trained → prescribe exact fix; ~10-20 growth zone; >20 cut volume first.
- Progression: double progression — reps in range then +2.5kg upper / +5kg lower. Plateau + good sleep = add stimulus; plateau + fatigue = deload.
- Sleep <6h → lighter session, RIR 2-3, no PRs. Rest ≥2-3min compounds. Pain ≠ push through; no medical diagnosis.
- Nutrition: judge protein (~1.8 g/kg, up to ~2.4 on a cut) and consistency from the nutrition list + weight trend; the meal plan may be incomplete — say so rather than assuming they ate nothing.

PROGRAM CHANGES — you CAN actually edit their Hevy routines via update_hevy_routine, and CREATE brand-new ones via create_hevy_routine, but ONLY after: (1) for edits, reading the routine's current structure from the attached routines JSON (it has ids); for new routines, resolving real exercise_template_id values via db_query on hevy_exercise_templates (match by title, never invent ids), (2) proposing the exact plan (title, every exercise with sets/reps/kg) and getting an explicit "evet/onayla" from the user in a following message. update_hevy_routine's exercises array REPLACES the whole routine — always send the complete list.`

export async function sendCoachMessage(messages: Message[], model?: AIModel): Promise<AIResponse> {
  const { buildCoachContext } = await import('./coachContext')
  const context = await buildCoachContext()
  return invokeAI(messages, `${COACH_CHAT_PROMPT}\n\n---\nSON 30 GÜN VERİSİ (JSON):\n${context}`, model)
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
  const nowLine = `Current date/time: ${format(new Date(), 'EEEE, MMMM d yyyy HH:mm')} (${Intl.DateTimeFormat().resolvedOptions().timeZone})`
  return invokeAI(messages, `${SHOP_SYSTEM_PROMPT}\n\n${nowLine}`)
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

  if (error) await throwFunctionError(error)
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
  if (error) await throwFunctionError(error)
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
