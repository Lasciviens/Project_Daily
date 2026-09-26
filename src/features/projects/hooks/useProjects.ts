import { useQuery } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { qk, STALE } from '../../../shared/query'
import {
  fetchProjects, fetchProjectStats, createProject, updateProject, deleteProject,
  fetchPhases, createPhase, updatePhase, deletePhase,
  fetchItems, createItem, updateItem, deleteItem,
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

export function useUpdateProject() {
  return useMutationWithFeedback({
    action:      'update_project',
    mutationFn:  ({ id, patch }: { id: string; patch: Partial<CreateProjectInput> }) => updateProject(id, patch),
    invalidates: [qk.projects.list()],
  })
}

export function useDeleteProject() {
  return useMutationWithFeedback({
    action:         'delete_project',
    successMessage: 'Project deleted',
    mutationFn:     (id: string) => deleteProject(id),
    invalidates:    [qk.projects.all],
  })
}

// ─── Phases ──────────────────────────────────────────────────────────────────

export function useCreatePhase(projectId: string) {
  return useMutationWithFeedback({
    action:      'create_phase',
    mutationFn:  (input: CreatePhaseInput) => createPhase(input),
    invalidates: [qk.projects.phases(projectId)],
  })
}

export function useUpdatePhase(projectId: string) {
  return useMutationWithFeedback({
    action:      'update_phase',
    mutationFn:  ({ id, patch }: { id: string; patch: Partial<Pick<ProjectPhase, 'name' | 'description' | 'status'>> }) =>
      updatePhase(id, patch),
    invalidates: [qk.projects.phases(projectId)],
  })
}

export function useDeletePhase(projectId: string) {
  return useMutationWithFeedback({
    action:      'delete_phase',
    mutationFn:  (id: string) => deletePhase(id),
    invalidates: [qk.projects.phases(projectId), qk.projects.items(projectId), qk.projects.stats()],
  })
}

// ─── Items ───────────────────────────────────────────────────────────────────

export function useCreateItem(projectId: string) {
  return useMutationWithFeedback({
    action:      'create_item',
    mutationFn:  (input: CreateItemInput) => createItem(input),
    invalidates: [qk.projects.items(projectId), qk.projects.stats()],
  })
}

export function useUpdateItem(projectId: string) {
  return useMutationWithFeedback({
    action:      'update_item',
    mutationFn:  ({ id, patch }: { id: string; patch: Partial<Pick<ProjectItem, 'title' | 'notes' | 'type' | 'status' | 'priority' | 'phase_id'>> }) =>
      updateItem(id, patch),
    invalidates: [qk.projects.items(projectId), qk.projects.stats()],
  })
}

export function useDeleteItem(projectId: string) {
  return useMutationWithFeedback({
    action:      'delete_item',
    mutationFn:  (id: string) => deleteItem(id),
    // A deleted item's planned block goes with it (migration 043 trigger).
    invalidates: [qk.projects.items(projectId), qk.projects.stats(), 'schedule'],
  })
}
