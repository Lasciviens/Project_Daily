import { format } from 'date-fns'
import { supabase } from '../../../integrations/supabase/client'

export interface Message {
  role:    'user' | 'assistant'
  content: string
}

const SYSTEM_PROMPT = `You are a personal productivity assistant for Lasci's Board — a private dashboard for daily planning, tasks, media tracking, training, and work management.

You have full read and write access to the user's data. You can:
- View all tasks, schedule, media library, and training sessions
- Create, update, complete, and delete tasks
- Add events to the day schedule/timeline
- Log workout sessions
- Plan media to watch (creates task + adds to timeline)

Always use get_tasks first when the user refers to a task by name — you need the ID to update/complete/delete it.

Be concise and practical. Confirm actions taken. Respond in the same language the user writes in (Turkish or English).`

async function buildContext(): Promise<string> {
  const today = format(new Date(), 'yyyy-MM-dd')

  const results = await Promise.allSettled([
    // Today's tasks with IDs
    supabase
      .from('tasks')
      .select('id, title, status, priority, domain, section, notes')
      .or(`section.eq.today,due_date.eq.${today}`)
      .neq('status', 'cancelled'),
    // This week
    supabase
      .from('tasks')
      .select('id, title, priority, domain')
      .eq('section', 'this_week')
      .neq('status', 'cancelled')
      .neq('status', 'done')
      .limit(8),
    // Inbox
    supabase
      .from('tasks')
      .select('id, title, priority')
      .eq('section', 'inbox')
      .neq('status', 'cancelled')
      .neq('status', 'done')
      .limit(5),
    // Work tasks
    supabase
      .from('tasks')
      .select('id, title, priority, section')
      .eq('domain', 'work')
      .neq('status', 'cancelled')
      .neq('status', 'done')
      .limit(8),
    // Watching movies
    supabase
      .from('user_movie_entries')
      .select('id, status, priority, movie:movies(title)')
      .in('status', ['watching', 'wishlist'])
      .limit(10),
    // Watching TV
    supabase
      .from('user_tv_entries')
      .select('id, status, current_season, current_episode, tv_series:tv_series(title)')
      .in('status', ['watching', 'paused'])
      .limit(10),
    // Today's schedule
    supabase
      .from('time_blocks')
      .select('title, start_time, duration_minutes')
      .eq('date', today)
      .order('start_time', { ascending: true })
      .limit(10),
    // Recent training
    supabase
      .from('training_sessions')
      .select('title, type, planned_date, duration_seconds')
      .order('planned_date', { ascending: false })
      .limit(5),
  ])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const get = <T>(i: number): T[] => {
    const r = results[i]
    return r.status === 'fulfilled' ? ((r.value as { data: T[] | null }).data ?? []) : []
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const todayRaw   = get<any>(0)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const weekTasks  = get<any>(1)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inbox      = get<any>(2)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const workTasks  = get<any>(3)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const movies     = get<any>(4)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tv         = get<any>(5)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const schedule   = get<any>(6)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const training   = get<any>(7)

  // Deduplicate today tasks
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const todayTasks = Array.from(new Map(todayRaw.map((t: any) => [t.id, t])).values()) as any[]

  const lines: string[] = [`DATE: ${format(new Date(), 'EEEE, MMMM d yyyy')}`]

  if (todayTasks.length) {
    lines.push(`\nTODAY'S TASKS (${todayTasks.length}):`)
    for (const t of todayTasks) {
      const mark = t.status === 'done' ? '[done]' : '[open]'
      lines.push(`  ${mark} [id:${t.id}] ${t.title} — ${t.priority} priority, ${t.domain}${t.notes ? ` | notes: ${t.notes}` : ''}`)
    }
  } else {
    lines.push('\nTODAY\'S TASKS: none')
  }

  if (weekTasks.length) {
    lines.push(`\nTHIS WEEK (${weekTasks.length}):`)
    for (const t of weekTasks) {
      lines.push(`  [id:${t.id}] ${t.title} (${t.domain})`)
    }
  }

  if (inbox.length) {
    lines.push(`\nINBOX (${inbox.length}):`)
    for (const t of inbox) {
      lines.push(`  [id:${t.id}] ${t.title}`)
    }
  }

  if (workTasks.length) {
    lines.push(`\nWORK TASKS (${workTasks.length}):`)
    for (const t of workTasks) {
      lines.push(`  [id:${t.id}] ${t.title} — ${t.section}`)
    }
  }

  if (schedule.length) {
    lines.push('\nTODAY\'S SCHEDULE:')
    for (const b of schedule) {
      const h = b.start_time ? b.start_time.slice(0, 5) : '?'
      lines.push(`  ${h} — ${b.title} (${b.duration_minutes}min)`)
    }
  }

  if (movies.length) {
    lines.push('\nMOVIE LIBRARY:')
    for (const m of movies) {
      lines.push(`  [${m.status}] [entry_id:${m.id}] ${m.movie?.title}`)
    }
  }

  if (tv.length) {
    lines.push('\nTV SERIES:')
    for (const s of tv) {
      lines.push(`  [${s.status}] [entry_id:${s.id}] ${s.tv_series?.title} — S${s.current_season}E${s.current_episode}`)
    }
  }

  if (training.length) {
    lines.push('\nRECENT TRAINING:')
    for (const s of training) {
      const dur = s.duration_seconds ? ` (${Math.round(s.duration_seconds / 60)}min)` : ''
      lines.push(`  ${s.planned_date} — ${s.title} [${s.type}]${dur}`)
    }
  }

  return lines.join('\n')
}

export async function sendMessage(messages: Message[]): Promise<string> {
  const context = await buildContext()
  const systemWithContext = `${SYSTEM_PROMPT}\n\n---\nLIVE DATA:\n${context}`

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
