import { useQuery } from '@tanstack/react-query'
import { qk, STALE } from '../../../shared/query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { useRowsDelete } from '../../../shared/hooks/useRowsDelete'
import {
  fetchWorkNote,
  upsertWorkNote,
  fetchPinnedLinks,
  createPinnedLink,
  fetchWeeklyGoals,
  createWeeklyGoal,
  toggleWeeklyGoal,
} from '../api/workApi'

export function useWorkNote() {
  return useQuery({ queryKey: qk.work.note(), queryFn: fetchWorkNote, staleTime: STALE.default })
}

// Autosave: silent on success (the widget shows "Saved"), but a failure is
// always toasted + logged — it used to vanish without a trace.
export function useUpsertWorkNote() {
  return useMutationWithFeedback({
    action: 'upsert_work_note',
    silent: 'autosave while typing — the widget shows "Saved"',
    errorFallback: "Couldn't save your notes",
    mutationFn: (content: string) => upsertWorkNote(content),
    invalidates: [qk.work.note()],
  })
}

export function usePinnedLinks() {
  return useQuery({ queryKey: qk.work.links(), queryFn: fetchPinnedLinks, staleTime: STALE.long })
}

export function useCreatePinnedLink() {
  return useMutationWithFeedback({
    action: 'create_pinned_link',
    successMessage: 'Link added',
    mutationFn: ({ title, url }: { title: string; url: string }) => createPinnedLink(title, url),
    invalidates: [qk.work.links()],
  })
}

export function useDeletePinnedLink() {
  return useRowsDelete({ table: 'work_pinned_links', action: 'delete_pinned_link', invalidates: [qk.work.links()], cache: qk.work.links() })
}

export function useWeeklyGoals(weekStart: string) {
  return useQuery({
    queryKey: qk.work.goals(weekStart),
    queryFn: () => fetchWeeklyGoals(weekStart),
    staleTime: STALE.default,
  })
}

export function useCreateWeeklyGoal() {
  return useMutationWithFeedback({
    action: 'create_weekly_goal',
    successMessage: 'Goal added',
    mutationFn: ({ weekStart, title }: { weekStart: string; title: string }) => createWeeklyGoal(weekStart, title),
    invalidates: [qk.work.goalsAll],
  })
}

export function useToggleWeeklyGoal() {
  return useMutationWithFeedback({
    action: 'toggle_weekly_goal',
    successMessage: (_r, { done }) => (done ? 'Goal done' : 'Goal reopened'),
    mutationFn: ({ id, done }: { id: string; done: boolean }) => toggleWeeklyGoal(id, done),
    invalidates: [qk.work.goalsAll],
  })
}

export function useDeleteWeeklyGoal() {
  return useRowsDelete({ table: 'work_weekly_goals', action: 'delete_weekly_goal', invalidates: [qk.work.goalsAll], cache: qk.work.goalsAll })
}
