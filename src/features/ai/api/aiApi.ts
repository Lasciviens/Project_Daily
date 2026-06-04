import { supabase } from '../../../integrations/supabase/client'

export interface Message {
  role:    'user' | 'assistant'
  content: string
}

const SYSTEM_PROMPT = `You are a personal productivity assistant for Lasci's Board — a private dashboard for daily planning, tasks, media tracking, and work management.

Be concise and practical. Help with:
- Task prioritization and planning
- Daily/weekly schedule suggestions
- Media recommendations
- Work task breakdown
- General productivity advice

Keep responses short and actionable. Use bullet points when listing things.`

export async function sendMessage(messages: Message[]): Promise<string> {
  const { data, error } = await supabase.functions.invoke('ai-proxy', {
    body: { messages, systemPrompt: SYSTEM_PROMPT },
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
