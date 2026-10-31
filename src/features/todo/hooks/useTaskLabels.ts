import { useQuery } from '@tanstack/react-query'
import { qk, STALE } from '../../../shared/query'
import { fetchTaskLabels } from '../api/tasksApi'

/** The owner's labels, most used first (under the tasks key: a task's save refreshes them). */
export function useTaskLabels(enabled = true) {
  return useQuery({ queryKey: qk.tasks.labels(), queryFn: fetchTaskLabels, staleTime: STALE.default, enabled })
}
