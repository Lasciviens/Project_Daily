import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchProjects, createProject, updateProject, deleteProject,
  fetchPhases, createPhase, updatePhase, deletePhase,
  fetchItems, createItem, updateItem, deleteItem,
} from '../api/projectsApi'
import type { CreateProjectInput, CreatePhaseInput, CreateItemInput, ProjectPhase, ProjectItem } from '../types'

const QK = {
  projects:           ['projects'] as const,
  phases:  (pid: string) => ['projects', 'phases', pid] as const,
  items:   (pid: string) => ['projects', 'items',  pid] as const,
}

export function useProjects() {
  return useQuery({ queryKey: QK.projects, queryFn: fetchProjects, staleTime: 60_000 })
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
    onSuccess:  () => qc.invalidateQueries({ queryKey: QK.projects }),
  })
}

export function useUpdateProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<CreateProjectInput> }) =>
      updateProject(id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.projects }),
  })
}

export function useDeleteProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteProject(id),
    onSuccess:  () => qc.invalidateQueries({ queryKey: QK.projects }),
  })
}

// ─── Phase mutations ──────────────────────────────────────────────────────────

export function useCreatePhase(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreatePhaseInput) => createPhase(input),
    onSuccess:  () => qc.invalidateQueries({ queryKey: QK.phases(projectId) }),
  })
}

export function useUpdatePhase(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Pick<ProjectPhase, 'name' | 'description' | 'status'>> }) =>
      updatePhase(id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.phases(projectId) }),
  })
}

export function useDeletePhase(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deletePhase(id),
    onSuccess:  () => qc.invalidateQueries({ queryKey: QK.phases(projectId) }),
  })
}

// ─── Item mutations ───────────────────────────────────────────────────────────

export function useCreateItem(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateItemInput) => createItem(input),
    onSuccess:  () => qc.invalidateQueries({ queryKey: QK.items(projectId) }),
  })
}

export function useUpdateItem(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Pick<ProjectItem, 'title' | 'notes' | 'type' | 'status' | 'priority'>> }) =>
      updateItem(id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.items(projectId) }),
  })
}

export function useDeleteItem(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteItem(id),
    onSuccess:  () => qc.invalidateQueries({ queryKey: QK.items(projectId) }),
  })
}
