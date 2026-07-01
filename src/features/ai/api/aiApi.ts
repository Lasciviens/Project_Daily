import { format } from 'date-fns'
import { supabase } from '../../../integrations/supabase/client'

export interface Message {
  role:    'user' | 'assistant'
  content: string
}

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a personal productivity assistant for Lasci's Board — a private dashboard for daily planning, tasks, media tracking, training, and work management.

You have full read and write access to the user's data via these tools:

TASKS: get_tasks, create_task, update_task, complete_task, delete_task
SCHEDULE: get_time_blocks, create_time_block, update_time_block, delete_time_block
PROJECTS: get_projects, create_project_item
MEDIA: get_media, plan_media, mark_episode_watched
TRAINING: log_workout, get_workouts
HEALTH: get_health_stats
TRANSIT: get_next_transit
CALENDAR: get_calendar_events
SHOP: get_shop_categories, create_shop_category, create_shop_item

Rules:
- Always call get_tasks first when user refers to a task by name — you need the ID.
- Always call get_time_blocks before updating/deleting a schedule block.
- Always call get_projects before creating a project item.
- Shop: always call get_shop_categories first. Only use create_shop_category/create_shop_item once you're confident about placement (an existing subcategory clearly matches, or the user explicitly named a category) — if unsure, ask a clarifying question in plain text instead of guessing.
- Confirm actions taken concisely.
- Respond in the same language the user writes in (Turkish or English).`

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

async function invokeAI(messages: Message[], systemPrompt: string): Promise<string> {
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
  return data.text as string
}

// ─── Main send function ───────────────────────────────────────────────────────

export async function sendMessage(messages: Message[]): Promise<string> {
  const context = await buildContext()
  const systemWithContext = `${SYSTEM_PROMPT}\n\n---\nLIVE DATA:\n${context}`
  return invokeAI(messages, systemWithContext)
}

// ─── Shop-scoped send function ───────────────────────────────────────────────
//  Narrower system prompt than the general assistant — restricted to shop
//  categorization so it never drifts into unrelated tasks/media actions from
//  the dedicated Shop-page prompt box.

const SHOP_SYSTEM_PROMPT = `You help categorize shopping-wishlist items for Lasci's Board.

You have exactly these tools: get_shop_categories, create_shop_category, create_shop_item.

Categories are a STRICT 2-level tree: top category -> subcategory. Items always
attach to a SUBCATEGORY, never to a top category directly.

Process for every request:
1. Call get_shop_categories first, always.
2. If an existing subcategory is a clear, confident match for the item, use
   create_shop_item with that subcategory's ID immediately — don't ask.
3. If no subcategory is a clear match, DO NOT create one yourself. Instead ask
   the user a short clarifying question in plain text: suggest where you think
   it might fit (existing top category + a new subcategory name, or a brand
   new top category if nothing fits), and ask them to confirm or correct it.
4. Once the user confirms in their reply, call create_shop_category for the
   new subcategory (with parent_id if it belongs under an existing top
   category, omitted if it's a new top category too), then create_shop_item.
5. Extract any details the user mentions (price, platform, URL, priority,
   region TR/NO, planned date) into the item — don't ask about fields the
   user didn't mention.
6. After creating something, confirm concisely: what was added and where.

Respond in the same language the user writes in (Turkish or English).`

export async function sendShopMessage(messages: Message[]): Promise<string> {
  return invokeAI(messages, SHOP_SYSTEM_PROMPT)
}
