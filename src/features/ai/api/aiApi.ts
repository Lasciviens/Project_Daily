import { format } from 'date-fns'
import { supabase } from '../../../integrations/supabase/client'

export interface Message {
  role:    'user' | 'assistant'
  content: string
}

// ─── Error types ──────────────────────────────────────────────────────────────

export class RateLimitError extends Error {
  dailyLimit:   number
  retryAfterSec: number
  constructor(dailyLimit: number, retryAfterSec: number) {
    super('rate_limit')
    this.name = 'RateLimitError'
    this.dailyLimit    = dailyLimit
    this.retryAfterSec = retryAfterSec
  }
}

export class AINotConfiguredError extends Error {
  constructor() {
    super('not_configured')
    this.name = 'AINotConfiguredError'
  }
}

export class AIAuthError extends Error {
  constructor() {
    super('auth_error')
    this.name = 'AIAuthError'
  }
}

// ─── Daily usage tracking (localStorage) ─────────────────────────────────────

const USAGE_KEY = 'ai_daily_usage'

export interface DailyUsage {
  date:  string
  count: number
  limit: number
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

export function getDailyUsage(): DailyUsage {
  try {
    const raw = localStorage.getItem(USAGE_KEY)
    if (raw) {
      const parsed: DailyUsage = JSON.parse(raw)
      if (parsed.date === todayStr()) return parsed
    }
  } catch { /* ignore */ }
  return { date: todayStr(), count: 0, limit: 20 }
}

function saveUsage(usage: DailyUsage): void {
  try { localStorage.setItem(USAGE_KEY, JSON.stringify(usage)) } catch { /* ignore */ }
}

function incrementUsage(): void {
  const usage = getDailyUsage()
  usage.count += 1
  saveUsage(usage)
}

function updateLimit(limit: number): void {
  const usage = getDailyUsage()
  usage.limit = limit
  saveUsage(usage)
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

Rules:
- Always call get_tasks first when user refers to a task by name — you need the ID.
- Always call get_time_blocks before updating/deleting a schedule block.
- Always call get_projects before creating a project item.
- Confirm actions taken concisely.
- Respond in the same language the user writes in (Turkish or English).`

// ─── Context builder ──────────────────────────────────────────────────────────

async function buildContext(): Promise<string> {
  const today = format(new Date(), 'yyyy-MM-dd')

  const results = await Promise.allSettled([
    supabase.from('tasks').select('id, title, status, priority, domain, section, notes')
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
    supabase.from('training_sessions').select('title, type, planned_date, duration_seconds')
      .order('planned_date', { ascending: false }).limit(5),
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
      lines.push(`  ${mark} [id:${t.id}] ${t.title} — ${t.priority} priority, ${t.domain}${t.notes ? ` | notes: ${t.notes}` : ''}`)
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
    lines.push('\nRECENT TRAINING:')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const s of training) {
      const dur = s.duration_seconds ? ` (${Math.round(s.duration_seconds / 60)}min)` : ''
      lines.push(`  ${s.planned_date} — ${s.title} [${s.type}]${dur}`)
    }
  }

  return lines.join('\n')
}

// ─── Main send function ───────────────────────────────────────────────────────

export async function sendMessage(messages: Message[]): Promise<string> {
  const context = await buildContext()
  const systemWithContext = `${SYSTEM_PROMPT}\n\n---\nLIVE DATA:\n${context}`

  const { data, error } = await supabase.functions.invoke('ai-proxy', {
    body: { messages, systemPrompt: systemWithContext },
  })

  if (error) {
    // Try to parse the structured error body from the Edge Function
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const body = await (error as any).context?.json?.()
      if (body?.error === 'rate_limit') {
        updateLimit(body.daily_limit ?? 20)
        throw new RateLimitError(body.daily_limit ?? 20, body.retry_after ?? 60)
      }
      if (body?.error === 'AI not configured — add GEMINI_API_KEY to Supabase Vault') {
        throw new AINotConfiguredError()
      }
      if (body?.error === 'Unauthorized') {
        throw new AIAuthError()
      }
      if (body?.error) throw new Error(body.error)
    } catch (parsed) {
      if (
        parsed instanceof RateLimitError ||
        parsed instanceof AINotConfiguredError ||
        parsed instanceof AIAuthError
      ) throw parsed
    }
    throw new Error(error.message)
  }

  if (data?.error) {
    if (data.error === 'rate_limit') {
      updateLimit(data.daily_limit ?? 20)
      throw new RateLimitError(data.daily_limit ?? 20, data.retry_after ?? 60)
    }
    throw new Error(data.error)
  }

  incrementUsage()
  return data.text as string
}
