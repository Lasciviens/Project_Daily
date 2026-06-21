import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchWorkNote,
  upsertWorkNote,
  fetchPinnedLinks,
  createPinnedLink,
  deletePinnedLink,
  fetchWeeklyGoals,
  createWeeklyGoal,
  toggleWeeklyGoal,
  deleteWeeklyGoal,
} from '../api/workApi'

export function useWorkNote() {
  return useQuery({
    queryKey: ['work', 'note'],
    queryFn: fetchWorkNote,
  })
}

export function useUpsertWorkNote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (content: string) => upsertWorkNote(content),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['work', 'note'] }),
  })
}

export function usePinnedLinks() {
  return useQuery({
    queryKey: ['work', 'links'],
    queryFn: fetchPinnedLinks,
    staleTime: 10 * 60_000,
  })
}

export function useCreatePinnedLink() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ title, url }: { title: string; url: string }) =>
      createPinnedLink(title, url),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['work', 'links'] }),
  })
}

export function useDeletePinnedLink() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deletePinnedLink(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['work', 'links'] }),
  })
}

export function useWeeklyGoals(weekStart: string) {
  return useQuery({
    queryKey: ['work', 'goals', weekStart],
    queryFn: () => fetchWeeklyGoals(weekStart),
    staleTime: 5 * 60_000,
  })
}

export function useCreateWeeklyGoal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ weekStart, title }: { weekStart: string; title: string }) =>
      createWeeklyGoal(weekStart, title),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['work', 'goals'] }),
  })
}

export function useToggleWeeklyGoal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, done }: { id: string; done: boolean }) =>
      toggleWeeklyGoal(id, done),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['work', 'goals'] }),
  })
}

export function useDeleteWeeklyGoal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteWeeklyGoal(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['work', 'goals'] }),
  })
}
