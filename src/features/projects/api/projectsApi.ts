import { supabase } from '../../../integrations/supabase/client'
import { requireUser } from '../../../shared/utils/requireUser'
import type { Task } from '../../todo/types'
import { templateFor } from '../projectModel'
import type {
  BlockPatch, EntryFields, NewBlockInput, NewPhaseInput, NewProjectInput, NewProjectTaskInput, PhasePatch,
  Project, ProjectBlock, ProjectEntry, ProjectPatch, ProjectPhase,
} from '../types'

type PgError = { code?: string; message?: string } | null | undefined

// Before migration 162 the block tables and tasks.project_id don't exist:
// reads render empty, writes say which migration is missing.
const isMissingTable = (e: PgError) => e?.code === '42P01' || e?.code === 'PGRST205' || /Could not find the table/i.test(e?.message ?? '')
const isMissingColumn = (e: PgError) => e?.code === '42703' || e?.code === 'PGRST204' || /column .* does not exist/i.test(e?.message ?? '')
const MISSING_162 = 'Projects need migration 162 — it runs with the next deploy.'

/** Every page of an open-ended read (PostgREST returns at most 1,000 rows). */
async function allPages<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: PgError }>): Promise<T[]> {
  const size = 1000
  const out: T[] = []
  for (let from = 0; ; from += size) {
    const { data, error } = await page(from, from + size - 1)
    if (error) throw error
    out.push(...(data ?? []))
    if (!data || data.length < size) return out
  }
}

// ─── Projects ─────────────────────────────────────────────────────────────────

export async function fetchProjects(): Promise<Project[]> {
  const { data, error } = await supabase.from('projects').select('*').order('sort_order').order('created_at')
  if (error) throw error
  return (data ?? []) as Project[]
}

/** A new project with its template's phases and blocks, in one transaction. */
export async function createProject(input: NewProjectInput): Promise<Project> {
  const t = templateFor(input.kind)
  const { data, error } = await supabase.rpc('app_create_project', {
    p_project: { name: input.name, kind: input.kind, area: input.area, description: input.description ?? null },
    p_phases: t.phases.map(name => ({ name })),
    p_blocks: t.blocks.map(b => ({ kind: b.kind, title: b.title, settings: b.settings ?? {} })),
  })
  if (error) throw isMissingTable(error) || error.code === 'PGRST202' ? new Error(MISSING_162) : error
  return data as Project
}

export async function updateProject(id: string, patch: ProjectPatch): Promise<Project> {
  const user = await requireUser()
  const { data, error } = await supabase.from('projects').update(patch).eq('id', id).eq('user_id', user.id).select().single()
  if (error) throw isMissingColumn(error) ? new Error(MISSING_162) : error
  return data as Project
}

// ─── Phases ───────────────────────────────────────────────────────────────────

/** Every project's phases (the list counts them; a project page takes its own). */
export async function fetchAllPhases(): Promise<ProjectPhase[]> {
  return allPages<ProjectPhase>((from, to) =>
    supabase.from('project_phases').select('*').order('sort_order').order('created_at').order('id').range(from, to))
}

export async function createPhase(input: NewPhaseInput, sortOrder: number): Promise<ProjectPhase> {
  const user = await requireUser()
  const { data, error } = await supabase.from('project_phases')
    .insert({ ...input, user_id: user.id, sort_order: sortOrder }).select().single()
  if (error) throw isMissingColumn(error) ? new Error(MISSING_162) : error
  return data as ProjectPhase
}

export async function updatePhase(id: string, patch: PhasePatch): Promise<ProjectPhase> {
  const user = await requireUser()
  const { data, error } = await supabase.from('project_phases').update(patch).eq('id', id).eq('user_id', user.id).select().single()
  if (error) throw isMissingColumn(error) ? new Error(MISSING_162) : error
  return data as ProjectPhase
}

// ─── A project's tasks (tasks with project_id, migration 162) ────────────────

/** Every project's tasks. */
export async function fetchProjectTasks(): Promise<Task[]> {
  try {
    return await allPages<Task>((from, to) =>
      supabase.from('tasks').select('*').not('project_id', 'is', null)
        .order('sort_order').order('created_at').order('id').range(from, to))
  } catch (e) {
    // Before 162 the old items still live in project_items: say so rather than show an empty plan.
    if (isMissingColumn(e as PgError)) throw new Error(MISSING_162, { cause: e })
    throw e
  }
}

/** A new task in a project: undated, in Backlog, not on Google until the owner plans it. */
export async function createProjectTask(input: NewProjectTaskInput, sortOrder: number): Promise<Task> {
  const user = await requireUser()
  const { data, error } = await supabase.from('tasks').insert({
    user_id: user.id, title: input.title, domain: input.domain, section: 'backlog', status: 'open', priority: 'medium',
    source_type: 'manual', google_sync_enabled: false, sort_order: sortOrder,
    project_id: input.project_id, project_phase_id: input.project_phase_id,
  }).select().single()
  if (error) throw isMissingColumn(error) ? new Error(MISSING_162) : error
  return data as Task
}

/** Moves a task to another phase of its project (null = no phase). */
export async function moveProjectTask(id: string, phaseId: string | null): Promise<Task> {
  const user = await requireUser()
  const { data, error } = await supabase.from('tasks').update({ project_phase_id: phaseId })
    .eq('id', id).eq('user_id', user.id).select().single()
  if (error) throw isMissingColumn(error) ? new Error(MISSING_162) : error
  return data as Task
}

// ─── Blocks ───────────────────────────────────────────────────────────────────

export async function fetchBlocks(projectId: string): Promise<ProjectBlock[]> {
  const { data, error } = await supabase.from('project_blocks').select('*')
    .eq('project_id', projectId).order('sort_order').order('created_at')
  if (error) {
    if (isMissingTable(error)) return []
    throw error
  }
  return (data ?? []) as ProjectBlock[]
}

export async function createBlock(input: NewBlockInput, sortOrder: number): Promise<ProjectBlock> {
  const user = await requireUser()
  const { data, error } = await supabase.from('project_blocks')
    .insert({ ...input, settings: input.settings ?? {}, user_id: user.id, sort_order: sortOrder }).select().single()
  if (error) throw isMissingTable(error) ? new Error(MISSING_162) : error
  return data as ProjectBlock
}

export async function updateBlock(id: string, patch: BlockPatch): Promise<ProjectBlock> {
  const user = await requireUser()
  const { data, error } = await supabase.from('project_blocks').update(patch).eq('id', id).eq('user_id', user.id).select().single()
  if (error) throw error
  return data as ProjectBlock
}

// ─── Entries ──────────────────────────────────────────────────────────────────

export async function fetchEntries(projectId: string): Promise<ProjectEntry[]> {
  try {
    return await allPages<ProjectEntry>((from, to) =>
      supabase.from('project_entries').select('*').eq('project_id', projectId)
        .order('sort_order').order('created_at').order('id').range(from, to))
  } catch (e) {
    if (isMissingTable(e as PgError)) return []
    throw e
  }
}

/** Every project's open questions (the list's "2 open questions"). */
export async function fetchOpenQuestions(): Promise<Array<Pick<ProjectEntry, 'id' | 'project_id'>>> {
  try {
    return await allPages<Pick<ProjectEntry, 'id' | 'project_id'>>((from, to) =>
      supabase.from('project_entries').select('id, project_id').eq('state', 'open').order('id').range(from, to))
  } catch (e) {
    if (isMissingTable(e as PgError)) return []
    throw e
  }
}

export async function createEntry(block: Pick<ProjectBlock, 'id' | 'project_id'>, fields: EntryFields): Promise<ProjectEntry> {
  const user = await requireUser()
  // The database sets project_id from the block whatever is sent (162's trigger).
  const { data, error } = await supabase.from('project_entries')
    .insert({ ...fields, block_id: block.id, project_id: block.project_id, user_id: user.id }).select().single()
  if (error) throw isMissingTable(error) ? new Error(MISSING_162) : error
  return data as ProjectEntry
}

export async function updateEntry(id: string, fields: EntryFields): Promise<ProjectEntry> {
  const user = await requireUser()
  const { data, error } = await supabase.from('project_entries').update(fields).eq('id', id).eq('user_id', user.id).select().single()
  if (error) throw error
  return data as ProjectEntry
}
