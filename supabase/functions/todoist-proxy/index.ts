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

Deno.serve(async (req) => {
  const origin  = req.headers.get('origin')
  const headers = corsHeaders(origin)

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers })
  }

  try {
    const authHeader = req.headers.get('authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...headers, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )
    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    )
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...headers, 'Content-Type': 'application/json' },
      })
    }

    const TODOIST_TOKEN = Deno.env.get('TODOIST_API_KEY')
    if (!TODOIST_TOKEN) {
      return new Response(JSON.stringify({ error: 'Todoist not configured' }), {
        status: 503,
        headers: { ...headers, 'Content-Type': 'application/json' },
      })
    }

    const { action, taskId, task } = await req.json()
    const BASE = 'https://api.todoist.com/api/v1'

    let todoistRes: Response

    if (action === 'list') {
      todoistRes = await fetch(`${BASE}/tasks`, {
        method:  'GET',
        headers: { Authorization: `Bearer ${TODOIST_TOKEN}` },
      })
    } else if (action === 'create') {
      todoistRes = await fetch(`${BASE}/tasks`, {
        method:  'POST',
        headers: { Authorization: `Bearer ${TODOIST_TOKEN}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify(task),
      })
    } else if (action === 'close') {
      todoistRes = await fetch(`${BASE}/tasks/${taskId}/close`, {
        method:  'POST',
        headers: { Authorization: `Bearer ${TODOIST_TOKEN}` },
      })
    } else if (action === 'reopen') {
      todoistRes = await fetch(`${BASE}/tasks/${taskId}/reopen`, {
        method:  'POST',
        headers: { Authorization: `Bearer ${TODOIST_TOKEN}` },
      })
    } else if (action === 'delete') {
      todoistRes = await fetch(`${BASE}/tasks/${taskId}`, {
        method:  'DELETE',
        headers: { Authorization: `Bearer ${TODOIST_TOKEN}` },
      })
    } else {
      return new Response(JSON.stringify({ error: 'Unknown action' }), {
        status: 400,
        headers: { ...headers, 'Content-Type': 'application/json' },
      })
    }

    if (todoistRes.status === 204) {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ...headers, 'Content-Type': 'application/json' },
      })
    }

    if (!todoistRes.ok) {
      const err = await todoistRes.text()
      console.error('[todoist-proxy] Todoist error', todoistRes.status, err)
      return new Response(JSON.stringify({ error: `Todoist ${todoistRes.status}: ${err}` }), {
        status: 502,
        headers: { ...headers, 'Content-Type': 'application/json' },
      })
    }

    const raw = await todoistRes.json()
    // Todoist v1 may return { results: [...] } or plain array
    const data = Array.isArray(raw) ? raw : (raw.results ?? raw.items ?? raw)
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { ...headers, 'Content-Type': 'application/json' },
    })
  } catch {
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...headers, 'Content-Type': 'application/json' },
    })
  }
})
