import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchProjects, fetchProjectStats, createProject, updateProject, deleteProject,
  fetchPhases, createPhase, updatePhase, deletePhase,
  fetchItems, createItem, updateItem, deleteItem,
} from '../api/projectsApi'
import { toast } from '../../../app/store'
import { logError } from '../../../shared/utils/logError'
import type { CreateProjectInput, CreatePhaseInput, CreateItemInput, ProjectPhase, ProjectItem } from '../types'

const QK = {
  projects:          ['projects'] as const,
  stats:             ['projects', 'stats'] as const,
  phases: (pid: string) => ['projects', 'phases', pid] as const,
  items:  (pid: string) => ['projects', 'items',  pid] as const,
}

// Toasts the failure AND persists it to app_error_logs (Developer > Errors) —
// these mutations previously only toasted, so a failure was invisible in the
// error log even though the user saw it happen.
const errToast = (fallback: string, action: string) => (err: unknown, vars?: unknown) => {
  const msg = (err as Error)?.message ?? fallback
  toast.error(msg)
  logError(`${fallback}: ${msg}`, { action, payload: vars })
}

export function useProjects() {
  return useQuery({ queryKey: QK.projects, queryFn: fetchProjects, staleTime: 60_000 })
}

export function useProjectStats() {
  return useQuery({ queryKey: QK.stats, queryFn: fetchProjectStats, staleTime: 30_000 })
}

export function usePhases(projectId: string | null) {
  return useQuery({
    queryKey: QK.phases(projectId ?? ''),
    queryFn:  () => fetchPhases(projectId!),
    enabled:  !!projectId,
    staleTime: 30_000,
  })
}

export function useItems(projectId: string | null) {
  return useQuery({
    queryKey: QK.items(projectId ?? ''),
    queryFn:  () => fetchItems(projectId!),
    enabled:  !!projectId,
    staleTime: 30_000,
  })
}

// ─── Project mutations ────────────────────────────────────────────────────────

export function useCreateProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateProjectInput) => createProject(input),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: QK.projects }); toast.success('Project created ✓') },
    onError:    errToast('Failed to create project', 'create_project'),
  })
}

export function useUpdateProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<CreateProjectInput> }) =>
      updateProject(id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.projects }),
    onError:   errToast('Failed to save project', 'update_project'),
  })
}

export function useDeleteProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteProject(id),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: QK.projects }); qc.invalidateQueries({ queryKey: QK.stats }); toast.success('Project deleted') },
    onError:    errToast('Failed to delete project', 'delete_project'),
  })
}

// ─── Phase mutations ──────────────────────────────────────────────────────────

export function useCreatePhase(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreatePhaseInput) => createPhase(input),
    onSuccess:  () => qc.invalidateQueries({ queryKey: QK.phases(projectId) }),
    onError:    errToast('Failed to add phase', 'create_phase'),
  })
}

export function useUpdatePhase(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Pick<ProjectPhase, 'name' | 'description' | 'status'>> }) =>
      updatePhase(id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.phases(projectId) }),
    onError:   errToast('Failed to save phase', 'update_phase'),
  })
}

export function useDeletePhase(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deletePhase(id),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: QK.phases(projectId) })
      qc.invalidateQueries({ queryKey: QK.items(projectId) })
      qc.invalidateQueries({ queryKey: QK.stats })
    },
    onError: errToast('Failed to delete phase', 'delete_phase'),
  })
}

// ─── Item mutations ───────────────────────────────────────────────────────────

export function useCreateItem(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateItemInput) => createItem(input),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: QK.items(projectId) }); qc.invalidateQueries({ queryKey: QK.stats }) },
    onError:    errToast('Failed to add item', 'create_item'),
  })
}

export function useUpdateItem(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Pick<ProjectItem, 'title' | 'notes' | 'type' | 'status' | 'priority' | 'phase_id'>> }) =>
      updateItem(id, patch),
    onSuccess: () => { qc.invalidateQueries({ queryKey: QK.items(projectId) }); qc.invalidateQueries({ queryKey: QK.stats }) },
    onError:   errToast('Failed to save item', 'update_item'),
  })
}

export function useDeleteItem(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteItem(id),
    // Deleting a project item cascades to its planned time_block via migration
    // 043's cleanup_block_on_project_item_delete trigger, so refresh schedule too.
    onSuccess:  () => { qc.invalidateQueries({ queryKey: QK.items(projectId) }); qc.invalidateQueries({ queryKey: QK.stats }); qc.invalidateQueries({ queryKey: ['schedule'] }) },
    onError:    errToast('Failed to delete item', 'delete_item'),
  })
}
