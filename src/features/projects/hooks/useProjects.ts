import { useQuery } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { useRowsDelete } from '../../../shared/hooks/useRowsDelete'
import { BLOCK_EVENT_RESET, relinkRestoredBlockEvents, removeDeletedBlockEvents } from '../../calendar/api/deletedBlockEvents'
import { qk, STALE } from '../../../shared/query'
import {
  fetchProjects, fetchProjectStats, createProject, updateProject,
  fetchPhases, createPhase, updatePhase,
  fetchItems, createItem, updateItem,
} from '../api/projectsApi'
import type { CreateProjectInput, CreatePhaseInput, CreateItemInput, ProjectPhase, ProjectItem } from '../types'

export function useProjects({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({ queryKey: qk.projects.list(), queryFn: fetchProjects, staleTime: STALE.short, enabled })
}

export function useProjectStats({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({ queryKey: qk.projects.stats(), queryFn: fetchProjectStats, staleTime: STALE.live, enabled })
}

export function usePhases(projectId: string | null) {
  return useQuery({
    queryKey: qk.projects.phases(projectId ?? ''),
    queryFn:  () => fetchPhases(projectId!),
    enabled:  !!projectId,
    staleTime: STALE.live,
  })
}

export function useItems(projectId: string | null) {
  return useQuery({
    queryKey: qk.projects.items(projectId ?? ''),
    queryFn:  () => fetchItems(projectId!),
    enabled:  !!projectId,
    staleTime: STALE.live,
  })
}

// ─── Projects ────────────────────────────────────────────────────────────────

export function useCreateProject() {
  return useMutationWithFeedback({
    action:         'create_project',
    successMessage: 'Project created',
    mutationFn:     (input: CreateProjectInput) => createProject(input),
    invalidates:    [qk.projects.all],
  })
}

/** `report: false` for the notes autosave (its card shows "Saved"). */
export function useUpdateProject({ report = true }: { report?: boolean } = {}) {
  return useMutationWithFeedback({
    action:      'update_project',
    successMessage: () => (report ? 'Project saved' : undefined),
    mutationFn:  ({ id, patch }: { id: string; patch: Partial<CreateProjectInput> }) => updateProject(id, patch),
    invalidates: [qk.projects.list()],
  })
}

/** Deletes a project with its phases, items and the items' planned slots — Undo puts all of it back. */
export function useDeleteProject() {
  return useRowsDelete({
    table: 'projects', action: 'delete_project', invalidates: [qk.projects.all, 'schedule'], cache: qk.projects.all,
    afterDelete: removeDeletedBlockEvents, overrides: () => BLOCK_EVENT_RESET, afterRestore: relinkRestoredBlockEvents,
  })
}

// ─── Phases ──────────────────────────────────────────────────────────────────

export function useCreatePhase(projectId: string) {
  return useMutationWithFeedback({
    action:      'create_phase',
    successMessage: 'Phase added',
    mutationFn:  (input: CreatePhaseInput) => createPhase(input),
    invalidates: [qk.projects.phases(projectId)],
  })
}

export function useUpdatePhase(projectId: string) {
  return useMutationWithFeedback({
    action:      'update_phase',
    successMessage: 'Phase saved',
    mutationFn:  ({ id, patch }: { id: string; patch: Partial<Pick<ProjectPhase, 'name' | 'description' | 'status'>> }) =>
      updatePhase(id, patch),
    invalidates: [qk.projects.phases(projectId)],
  })
}

export function useDeletePhase(projectId: string) {
  return useRowsDelete({
    table: 'project_phases', action: 'delete_phase',
    invalidates: [qk.projects.phases(projectId), qk.projects.items(projectId), qk.projects.stats(), 'schedule'],
    cache: qk.projects.all,
    afterDelete: removeDeletedBlockEvents, overrides: () => BLOCK_EVENT_RESET, afterRestore: relinkRestoredBlockEvents,
  })
}

// ─── Items ───────────────────────────────────────────────────────────────────

/** The item popup reports its own save ("Item created"). */
export function useCreateItem(projectId: string) {
  return useMutationWithFeedback({
    action:      'create_item',
    silent:      'the item popup reports the save',
    mutationFn:  (input: CreateItemInput) => createItem(input),
    invalidates: [qk.projects.items(projectId), qk.projects.stats()],
  })
}

/** `report: false` for the item popup, which reports its own save. */
export function useUpdateItem(projectId: string, { report = true }: { report?: boolean } = {}) {
  return useMutationWithFeedback({
    action:      'update_item',
    successMessage: (_r, { patch }) => (!report ? undefined : patch.status === 'done' ? 'Item done' : patch.status ? 'Item moved' : 'Item saved'),
    mutationFn:  ({ id, patch }: { id: string; patch: Partial<Pick<ProjectItem, 'title' | 'notes' | 'type' | 'status' | 'priority' | 'phase_id'>> }) =>
      updateItem(id, patch),
    invalidates: [qk.projects.items(projectId), qk.projects.stats()],
  })
}

/** Deletes an item and its planned slot (migration 043's rule) — Undo puts both back. */
export function useDeleteItem(projectId: string) {
  return useRowsDelete({
    table: 'project_items', action: 'delete_item',
    invalidates: [qk.projects.items(projectId), qk.projects.stats(), 'schedule'],
    cache: qk.projects.all,
    afterDelete: removeDeletedBlockEvents, overrides: () => BLOCK_EVENT_RESET, afterRestore: relinkRestoredBlockEvents,
  })
}
