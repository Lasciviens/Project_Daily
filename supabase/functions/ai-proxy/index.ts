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
    const { messages, systemPrompt } = await req.json() as { messages: Message[]; systemPrompt?: string }
    if (!messages?.length) {
      return new Response(JSON.stringify({ error: 'messages required' }), {
        status: 400, headers: { ...headers, 'Content-Type': 'application/json' },
      })
    }

    const GEMINI_KEY = Deno.env.get('GEMINI_API_KEY')
    if (!GEMINI_KEY) {
      return new Response(JSON.stringify({ error: 'AI not configured — add GEMINI_API_KEY to Supabase Vault' }), {
        status: 503, headers: { ...headers, 'Content-Type': 'application/json' },
      })
    }

    const text = await callGemini(GEMINI_KEY, messages, systemPrompt, supabase, user.id)
    return new Response(JSON.stringify({ text }), {
      status: 200, headers: { ...headers, 'Content-Type': 'application/json' },
    })
  } catch (err) {
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
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`

  let contents: AnyRecord[] = messages.map(m => ({
    role:  m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }))

  const baseBody: AnyRecord = { tools: TOOLS }
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
      throw new Error(`Gemini ${res.status}: ${errText}`)
    }

    const data      = await res.json()
    const candidate = data.candidates?.[0]
    if (!candidate) return ''

    const parts: AnyRecord[] = candidate.content?.parts ?? []
    const fnCall = parts.find((p: AnyRecord) => p.functionCall)

    if (!fnCall?.functionCall) {
      // No more function calls — return the text response
      return parts.find((p: AnyRecord) => p.text)?.text ?? ''
    }

    const { name, args } = fnCall.functionCall
    const result = await dispatch(name, args, supabase, userId)

    // Append this turn's exchange to the conversation
    contents = [
      ...contents,
      { role: 'model', parts: [{ functionCall: fnCall.functionCall }] },
      { role: 'user',  parts: [{ functionResponse: { name, response: result } }] },
    ]
  }

  return 'Done — all requested actions completed.'
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
    case 'get_media':       return getMedia(supabase, userId, args)
    case 'plan_media':      return planMedia(supabase, userId, args)
    default:                return { success: false, error: `Unknown function: ${name}` }
  }
}

async function getTasks(supabase: AnyRecord, userId: string, args: AnyRecord): Promise<AnyRecord> {
  let query = supabase
    .from('tasks')
    .select('id, title, status, priority, domain, section, due_date, notes')
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
