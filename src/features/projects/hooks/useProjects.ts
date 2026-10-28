import { useQuery, useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { useRowsDelete } from '../../../shared/hooks/useRowsDelete'
import { putRowsInCache } from '../../../shared/query/cachePatch'
import { BLOCK_EVENT_RESET, relinkRestoredBlockEvents, removeDeletedBlockEvents } from '../../calendar/api/deletedBlockEvents'
import { rowsOf } from '../../../shared/utils/deletedRows'
import { TASK_GOOGLE_RESET, syncGoogleTasksSoon } from '../../todo/hooks/useTodos'
import type { Task } from '../../todo/types'
import { qk, STALE } from '../../../shared/query'
import {
  fetchProjects, createProject, updateProject,
  fetchAllPhases, createPhase, updatePhase,
  fetchProjectTasks, createProjectTask, moveProjectTask,
  fetchBlocks, createBlock, updateBlock,
  fetchEntries, fetchOpenQuestions, createEntry, updateEntry,
} from '../api/projectsApi'
import { STATUS_LABEL, type MovePlan } from '../projectModel'
import type {
  BlockPatch, EntryFields, NewBlockInput, NewPhaseInput, NewProjectInput, NewProjectTaskInput, PhasePatch,
  ProjectBlock, ProjectPatch, ProjectPhase,
} from '../types'

/** Adds a new row to a cached list (if that list is loaded) so it shows before the re-read. */
function appendToList<T extends { id: string }>(qc: QueryClient, key: QueryKey, row: T) {
  qc.setQueryData<T[]>(key, list => (list && !list.some(r => r.id === row.id) ? [...list, row] : list))
}

// ─── Reads ───────────────────────────────────────────────────────────────────

export function useProjects() {
  return useQuery({ queryKey: qk.projects.list(), queryFn: fetchProjects, staleTime: STALE.short })
}

export function useAllPhases() {
  return useQuery({ queryKey: qk.projects.phases(), queryFn: fetchAllPhases, staleTime: STALE.short })
}

/** Every project's tasks — real tasks, so every task action (tick, edit, delete) refreshes them. */
export function useProjectTasks() {
  return useQuery({ queryKey: qk.tasks.projects(), queryFn: fetchProjectTasks, staleTime: STALE.short })
}

export function useBlocks(projectId: string | null) {
  return useQuery({
    queryKey: qk.projects.blocks(projectId ?? ''),
    queryFn: () => fetchBlocks(projectId!),
    enabled: !!projectId,
    staleTime: STALE.short,
  })
}

export function useEntries(projectId: string | null) {
  return useQuery({
    queryKey: qk.projects.entries(projectId ?? ''),
    queryFn: () => fetchEntries(projectId!),
    enabled: !!projectId,
    staleTime: STALE.short,
  })
}

export function useOpenQuestions() {
  return useQuery({ queryKey: qk.projects.openQuestions(), queryFn: fetchOpenQuestions, staleTime: STALE.short })
}

// ─── Projects ────────────────────────────────────────────────────────────────

/** The popup opens the new project's page next, so the lists are read again before it resolves. */
export function useCreateProject() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action: 'create_project',
    successMessage: p => `${p.name} created`,
    mutationFn: (input: NewProjectInput) => createProject(input),
    onSuccess: p => appendToList(qc, qk.projects.list(), p),
    invalidates: [qk.projects.all],
    refresh: 'wait',
  })
}

/** `report: false` when the caller reports the save itself. */
export function useUpdateProject({ report = true }: { report?: boolean } = {}) {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action: 'update_project',
    successMessage: (p, { patch }) => {
      if (!report) return undefined
      if (patch.status && Object.keys(patch).length === 1) return `${p.name}: ${STATUS_LABEL[patch.status]}`
      if (patch.status) return `Project saved · ${STATUS_LABEL[patch.status]}`
      if ('status_line' in patch && Object.keys(patch).length === 1) return patch.status_line ? 'Status updated' : 'Status cleared'
      return 'Project saved'
    },
    mutationFn: ({ id, patch }: { id: string; patch: ProjectPatch }) => updateProject(id, patch),
    onSuccess: p => putRowsInCache(qc, qk.projects.list(), [p]),
    // A move to Work or Personal moves the project's tasks too (162's trigger).
    invalidates: (_p, { patch }) => (patch.area ? [qk.projects.all, 'taskGraph'] : [qk.projects.all]),
  })
}

/** Deletes a project with its phases, tasks, blocks and entries — Undo puts all of it back (162's keys).
 *  Its tasks go the way a deleted task goes (useDeleteTask): their slots' Calendar events and Google
 *  Tasks copies are removed, and Undo makes them again. */
export function useDeleteProject() {
  return useRowsDelete({
    table: 'projects', action: 'delete_project', invalidates: [qk.projects.all, 'taskGraph'], cache: qk.projects.all,
    afterDelete: async snapshot => {
      await removeDeletedBlockEvents(snapshot)
      for (const t of rowsOf<Task>(snapshot, 'tasks')) syncGoogleTasksSoon({ taskId: t.id })
    },
    overrides: () => ({ ...TASK_GOOGLE_RESET, ...BLOCK_EVENT_RESET }),
    afterRestore: async snapshot => {
      for (const t of rowsOf<Task>(snapshot, 'tasks')) if (t.google_sync_enabled) syncGoogleTasksSoon({ taskId: t.id })
      return relinkRestoredBlockEvents(snapshot)
    },
  })
}

// ─── Phases ──────────────────────────────────────────────────────────────────

export function useCreatePhase() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action: 'create_phase',
    successMessage: p => `${p.name} added`,
    mutationFn: ({ input, sortOrder }: { input: NewPhaseInput; sortOrder: number }) => createPhase(input, sortOrder),
    onSuccess: p => appendToList(qc, qk.projects.phases(), p),
    invalidates: [qk.projects.phases()],
  })
}

/** `report: false` when the caller reports the save itself (a move reports "moved"). */
export function useUpdatePhase({ report = true }: { report?: boolean } = {}) {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action: 'update_phase',
    successMessage: (p, { patch }) => {
      if (!report) return undefined
      if (!patch.status) return 'Phase saved'
      const word = patch.status === 'done' ? 'done' : patch.status === 'in_progress' ? 'in progress' : 'not started'
      return Object.keys(patch).length === 1 ? `${p.name} ${word}` : `Phase saved · ${word}`
    },
    mutationFn: ({ id, patch }: { id: string; patch: PhasePatch }) => updatePhase(id, patch),
    onSuccess: p => putRowsInCache(qc, qk.projects.phases(), [p]),
    invalidates: [qk.projects.phases()],
  })
}

/** Moves a phase one place (projectModel.movePlan). */
export function useMovePhase() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action: 'move_phase',
    successMessage: (_rows, { moved }) => `${moved.name} moved`,
    mutationFn: ({ writes }: MovePlan<ProjectPhase>) => Promise.all(writes.map(w => updatePhase(w.id, { sort_order: w.sort_order }))),
    onSuccess: rows => putRowsInCache(qc, qk.projects.phases(), rows),
    invalidates: [qk.projects.phases()],
  })
}

/** Deletes a phase; its tasks stay in the project with no phase (162's SET NULL) and Undo puts them back in it. */
export function useDeletePhase() {
  return useRowsDelete({
    table: 'project_phases', action: 'delete_phase', invalidates: [qk.projects.phases(), 'taskGraph'], cache: qk.projects.all,
  })
}

// ─── A project's tasks ───────────────────────────────────────────────────────

export function useCreateProjectTask() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action: 'create_project_task',
    successMessage: 'Task added',
    mutationFn: ({ input, sortOrder }: { input: NewProjectTaskInput; sortOrder: number }) => createProjectTask(input, sortOrder),
    onSuccess: t => appendToList(qc, qk.tasks.projects(), t),
    invalidates: ['taskGraph'],
  })
}

export function useMoveProjectTask() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action: 'move_project_task',
    successMessage: (_t, { phaseName }) => (phaseName ? `Moved to ${phaseName}` : 'Moved out of its phase'),
    mutationFn: ({ id, phaseId }: { id: string; phaseId: string | null; phaseName: string | null }) => moveProjectTask(id, phaseId),
    onSuccess: t => putRowsInCache(qc, qk.tasks.projects(), [t]),
    invalidates: ['taskGraph'],
  })
}

// ─── Blocks ──────────────────────────────────────────────────────────────────

export function useCreateBlock() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action: 'create_block',
    successMessage: b => `${b.title} added`,
    mutationFn: ({ input, sortOrder }: { input: NewBlockInput; sortOrder: number }) => createBlock(input, sortOrder),
    onSuccess: b => appendToList(qc, qk.projects.blocks(b.project_id), b),
    invalidates: (b, { input }) => [qk.projects.blocks(b?.project_id ?? input.project_id)],
  })
}

export function useUpdateBlock({ report = true }: { report?: boolean } = {}) {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action: 'update_block',
    successMessage: () => (report ? 'Block saved' : undefined),
    mutationFn: ({ id, patch }: { id: string; projectId: string; patch: BlockPatch }) => updateBlock(id, patch),
    onSuccess: b => putRowsInCache(qc, qk.projects.blocks(b.project_id), [b]),
    invalidates: (_b, { projectId }) => [qk.projects.blocks(projectId)],
  })
}

/** Moves a block one place (projectModel.movePlan). */
export function useMoveBlock() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action: 'move_block',
    successMessage: (_rows, { moved }) => `${moved.title} moved`,
    mutationFn: ({ writes }: MovePlan<ProjectBlock>) => Promise.all(writes.map(w => updateBlock(w.id, { sort_order: w.sort_order }))),
    onSuccess: (rows, { moved }) => putRowsInCache(qc, qk.projects.blocks(moved.project_id), rows),
    invalidates: (_r, { moved }) => [qk.projects.blocks(moved.project_id)],
  })
}

/** Deletes a block with everything in it — Undo puts it all back. */
export function useDeleteBlock(projectId: string) {
  return useRowsDelete({
    table: 'project_blocks', action: 'delete_block',
    invalidates: [qk.projects.blocks(projectId), qk.projects.entries(projectId), qk.projects.openQuestions()],
    cache: qk.projects.all,
  })
}

// ─── Entries ─────────────────────────────────────────────────────────────────

/** `message` names what was added ("Log entry added", "Question added", "Row added"). */
export function useCreateEntry() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action: 'create_entry',
    successMessage: (_e, { message }) => message,
    mutationFn: ({ block, fields }: { block: Pick<ProjectBlock, 'id' | 'project_id'>; fields: EntryFields; message: string }) => createEntry(block, fields),
    onSuccess: e => appendToList(qc, qk.projects.entries(e.project_id), e),
    invalidates: e => (e ? [qk.projects.entries(e.project_id), qk.projects.openQuestions()] : [qk.projects.all]),
  })
}

export function useUpdateEntry() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action: 'update_entry',
    successMessage: (_e, { message }) => message,
    mutationFn: ({ id, fields }: { id: string; fields: EntryFields; message: string }) => updateEntry(id, fields),
    onSuccess: e => putRowsInCache(qc, qk.projects.entries(e.project_id), [e]),
    invalidates: e => (e ? [qk.projects.entries(e.project_id), qk.projects.openQuestions()] : [qk.projects.all]),
  })
}

export function useDeleteEntry(projectId: string) {
  return useRowsDelete({
    table: 'project_entries', action: 'delete_entry',
    invalidates: [qk.projects.entries(projectId), qk.projects.openQuestions()],
    cache: qk.projects.all,
  })
}
