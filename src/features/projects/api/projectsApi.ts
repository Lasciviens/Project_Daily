import { supabase } from '../../../integrations/supabase/client'
import type {
  Project, ProjectPhase, ProjectItem,
  CreateProjectInput, CreatePhaseInput, CreateItemInput,
} from '../types'

// ─── Projects ─────────────────────────────────────────────────────────────────

export async function fetchProjects(): Promise<Project[]> {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .order('sort_order')
  if (error) throw error
  return data ?? []
}

export async function createProject(input: CreateProjectInput): Promise<Project> {
  const { data, error } = await supabase
    .from('projects')
    .insert({ ...input })
    .select()
    .single()
  if (error) throw error
  return data
}

export interface ProjectStat { total: number; done: number; in_progress: number; open: number }

// One aggregate query for every item's (project_id, status) → per-project counts.
export async function fetchProjectStats(): Promise<Record<string, ProjectStat>> {
  const { data, error } = await supabase
    .from('project_items')
    .select('project_id, status')
  if (error) throw error
  const map: Record<string, ProjectStat> = {}
  for (const row of (data ?? []) as { project_id: string; status: string }[]) {
    const s = map[row.project_id] ?? { total: 0, done: 0, in_progress: 0, open: 0 }
    s.total++
    if (row.status === 'done') s.done++
    else if (row.status === 'in_progress') s.in_progress++
    else if (row.status === 'open') s.open++
    map[row.project_id] = s
  }
  return map
}

export async function updateProject(id: string, patch: Partial<CreateProjectInput>): Promise<void> {
  const { error } = await supabase
    .from('projects')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function deleteProject(id: string): Promise<void> {
  const { error } = await supabase.from('projects').delete().eq('id', id)
  if (error) throw error
}

// ─── Phases ───────────────────────────────────────────────────────────────────

export async function fetchPhases(projectId: string): Promise<ProjectPhase[]> {
  const { data, error } = await supabase
    .from('project_phases')
    .select('*')
    .eq('project_id', projectId)
    .order('sort_order')
  if (error) throw error
  return data ?? []
}

export async function createPhase(input: CreatePhaseInput): Promise<ProjectPhase> {
  const { data, error } = await supabase
    .from('project_phases')
    .insert({ ...input })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updatePhase(id: string, patch: Partial<Pick<ProjectPhase, 'name' | 'description' | 'status'>>): Promise<void> {
  const { error } = await supabase
    .from('project_phases')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function deletePhase(id: string): Promise<void> {
  const { error } = await supabase.from('project_phases').delete().eq('id', id)
  if (error) throw error
}

// ─── Items ────────────────────────────────────────────────────────────────────

export async function fetchItems(projectId: string): Promise<ProjectItem[]> {
  const { data, error } = await supabase
    .from('project_items')
    .select('*')
    .eq('project_id', projectId)
    .order('sort_order')
  if (error) throw error
  return data ?? []
}

export async function createItem(input: CreateItemInput): Promise<ProjectItem> {
  const { data, error } = await supabase
    .from('project_items')
    .insert({ ...input })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateItem(id: string, patch: Partial<Pick<ProjectItem, 'title' | 'notes' | 'type' | 'status' | 'priority' | 'phase_id'>>): Promise<void> {
  const { error } = await supabase
    .from('project_items')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function deleteItem(id: string): Promise<void> {
  const { error } = await supabase.from('project_items').delete().eq('id', id)
  if (error) throw error
}
