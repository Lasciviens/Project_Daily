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

interface Message {
  role:    'user' | 'assistant'
  content: string
}

const TOOLS = [
  {
    functionDeclarations: [
      {
        name: 'create_task',
        description: 'Create a new task in the user\'s board. Use this when the user asks to add, schedule, or plan something.',
        parameters: {
          type: 'OBJECT',
          properties: {
            title:    { type: 'STRING', description: 'Task title' },
            section:  { type: 'STRING', enum: ['today', 'tomorrow', 'this_week', 'inbox', 'backlog'], description: 'Which section to put the task in' },
            priority: { type: 'STRING', enum: ['low', 'medium', 'high'], description: 'Task priority' },
            domain:   { type: 'STRING', enum: ['personal', 'work', 'media'], description: 'Task domain/category' },
            due_date: { type: 'STRING', description: 'Due date in YYYY-MM-DD format (optional)' },
          },
          required: ['title', 'section', 'priority', 'domain'],
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
    const { messages, systemPrompt } = await req.json() as {
      messages:     Message[]
      systemPrompt?: string
    }

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

// deno-lint-ignore no-explicit-any
async function callGemini(apiKey: string, messages: Message[], systemPrompt: string | undefined, supabase: any, userId: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`

  const contents = messages.map(m => ({
    role:  m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }))

  // deno-lint-ignore no-explicit-any
  const body: Record<string, any> = { contents, tools: TOOLS }
  if (systemPrompt) {
    body.systemInstruction = { parts: [{ text: systemPrompt }] }
  }

  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Gemini ${res.status}: ${err}`)
  }

  const data = await res.json()
  const candidate = data.candidates?.[0]
  if (!candidate) return ''

  const parts = candidate.content?.parts ?? []

  // Check if Gemini wants to call a function
  const fnCall = parts.find((p: { functionCall?: unknown }) => p.functionCall)
  if (fnCall?.functionCall) {
    const { name, args } = fnCall.functionCall

    if (name === 'create_task') {
      const taskResult = await createTask(supabase, userId, args)

      // Send function result back to Gemini for a natural language reply
      const followUp = await fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          ...body,
          contents: [
            ...contents,
            { role: 'model', parts: [{ functionCall: fnCall.functionCall }] },
            { role: 'user',  parts: [{ functionResponse: { name, response: taskResult } }] },
          ],
        }),
      })
      if (followUp.ok) {
        const followData = await followUp.json()
        return followData.candidates?.[0]?.content?.parts?.[0]?.text ?? confirmationText(args)
      }
      return confirmationText(args)
    }
  }

  return parts.find((p: { text?: string }) => p.text)?.text ?? ''
}

// deno-lint-ignore no-explicit-any
async function createTask(supabase: any, userId: string, args: any): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.from('tasks').insert({
    user_id:    userId,
    title:      args.title,
    section:    args.section   ?? 'inbox',
    priority:   args.priority  ?? 'medium',
    domain:     args.domain    ?? 'personal',
    due_date:   args.due_date  ?? null,
    status:     'open',
    sort_order: 0,
    source_type: 'ai',
  }).select().single()

  if (error) return { success: false, error: error.message }
  return { success: true, task_id: data.id, title: data.title, section: data.section }
}

// deno-lint-ignore no-explicit-any
function confirmationText(args: any): string {
  const sectionMap: Record<string, string> = {
    today: 'bugüne', tomorrow: 'yarına', this_week: 'bu haftaya', inbox: 'gelen kutusuna', backlog: 'backlog\'a',
  }
  return `"${args.title}" görevi ${sectionMap[args.section] ?? args.section} eklendi.`
}
