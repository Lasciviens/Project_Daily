import { supabase } from '../../../integrations/supabase/client'
import { requireUser } from '../../../shared/utils/requireUser'

// ai_memory (migration 064) — durable notes/summaries/facts/preferences the AI
// is asked to keep, written today only from chat via the `save_memory` tool
// (kind: 'fact'|'preference'|'summary', source: 'ai') or a DB trigger-less
// direct insert with source: 'auto'. This API layer is the ONLY path that can
// ever produce a source: 'user' row — createMemory below stamps it, never
// trusting a caller-supplied value (there is no `source` param on its input).

export interface AiMemory {
  id:         string
  kind:       'note' | 'summary' | 'fact' | 'preference'
  title:      string
  content:    string
  source:     'user' | 'ai' | 'auto'
  created_at: string
  updated_at: string
}

export interface CreateMemoryInput {
  kind:    AiMemory['kind']
  title:   string
  content: string
}

export async function fetchMemories(): Promise<AiMemory[]> {
  const { data, error } = await supabase
    .from('ai_memory')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function createMemory(input: CreateMemoryInput): Promise<AiMemory> {
  const user = await requireUser()
  const { data, error } = await supabase
    .from('ai_memory')
    .insert({
      user_id: user.id,
      kind:    input.kind,
      title:   input.title,
      content: input.content,
      source:  'user',
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateMemory(
  id: string,
  patch: Partial<Pick<AiMemory, 'kind' | 'title' | 'content'>>,
): Promise<AiMemory> {
  const { data, error } = await supabase
    .from('ai_memory')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteMemory(id: string): Promise<void> {
  const { error } = await supabase.from('ai_memory').delete().eq('id', id)
  if (error) throw error
}
