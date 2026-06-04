import { format } from 'date-fns'
import { supabase } from '../../../integrations/supabase/client'

export interface Message {
  role:    'user' | 'assistant'
  content: string
}

const SYSTEM_PROMPT = `You are a personal productivity assistant for Lasci's Board — a private dashboard for daily planning, tasks, media tracking, and work management.

Be concise and practical. Help with:
- Task prioritization and planning
- Daily/weekly schedule suggestions
- Media recommendations based on the user's watchlist
- Work task breakdown
- General productivity advice

Keep responses short and actionable. Use bullet points when listing things.
Respond in the same language the user writes in (Turkish or English).`

async function buildContext(): Promise<string> {
  const today = format(new Date(), 'yyyy-MM-dd')

  const results = await Promise.allSettled([
    supabase
      .from('tasks')
      .select('id, title, status, priority, domain, section')
      .or(`section.eq.today,due_date.eq.${today}`)
      .neq('status', 'cancelled'),
    supabase
      .from('tasks')
      .select('title, priority, domain')
      .eq('section', 'this_week')
      .neq('status', 'cancelled')
      .neq('status', 'done')
      .limit(8),
    supabase
      .from('tasks')
      .select('title, priority, domain')
      .eq('section', 'inbox')
      .neq('status', 'cancelled')
      .neq('status', 'done')
      .limit(5),
    supabase
      .from('user_movie_entries')
      .select('status, priority, movie:movies(title)')
      .in('status', ['watching', 'wishlist'])
      .limit(10),
    supabase
      .from('user_tv_entries')
      .select('status, current_season, current_episode, tv_series:tv_series(title)')
      .in('status', ['watching', 'paused'])
      .limit(10),
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
  const movies    = get<any>(3)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tv        = get<any>(4)

  // Deduplicate today tasks (section=today AND due_date=today would return same task twice)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const todayTasks = Array.from(new Map(todayRaw.map((t: any) => [t.id, t])).values()) as any[]

  const lines: string[] = [`DATE: ${format(new Date(), 'EEEE, MMMM d yyyy')}`]

  if (todayTasks.length) {
    lines.push(`\nTODAY'S TASKS (${todayTasks.length}):`)
    for (const t of todayTasks) {
      const mark = t.status === 'done' ? '[done]' : '[open]'
      lines.push(`  ${mark} ${t.title} — ${t.priority} priority, ${t.domain}`)
    }
  } else {
    lines.push('\nTODAY\'S TASKS: none')
  }

  if (weekTasks.length) {
    lines.push(`\nTHIS WEEK — REMAINING (${weekTasks.length}):`)
    for (const t of weekTasks) {
      lines.push(`  - ${t.title} (${t.domain})`)
    }
  }

  if (inbox.length) {
    lines.push(`\nINBOX (${inbox.length} unprocessed):`)
    for (const t of inbox) {
      lines.push(`  - ${t.title}`)
    }
  }

  if (movies.length) {
    lines.push('\nMOVIE LIST:')
    for (const m of movies) {
      lines.push(`  [${m.status}] ${m.movie?.title}`)
    }
  }

  if (tv.length) {
    lines.push('\nTV SERIES:')
    for (const s of tv) {
      lines.push(`  [${s.status}] ${s.tv_series?.title} — S${s.current_season}E${s.current_episode}`)
    }
  }

  return lines.join('\n')
}

export async function sendMessage(messages: Message[]): Promise<string> {
  const context = await buildContext()
  const systemWithContext = `${SYSTEM_PROMPT}\n\n---\nUSER'S LIVE DATA:\n${context}`

  const { data, error } = await supabase.functions.invoke('ai-proxy', {
    body: { messages, systemPrompt: systemWithContext },
  })
  if (error) {
    let detail = error.message
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const body = await (error as any).context?.json?.()
      if (body?.error) detail = body.error
    } catch { /* ignore */ }
    throw new Error(detail)
  }
  if (data?.error) throw new Error(data.error)
  return data.text as string
}
