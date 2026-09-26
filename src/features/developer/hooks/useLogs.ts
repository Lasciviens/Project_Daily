import { useQuery } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { qk, STALE } from '../../../shared/query'
import {
  fetchErrorLogs, clearErrorLogs, fetchAuditLogs, clearAuditLogs, fetchProjectActivity,
  type AuditLogFilter,
} from '../api/logsApi'

export type { ErrorLog, AuditLog, AuditLogFilter } from '../api/logsApi'

export function useErrorLogs() {
  return useQuery({
    queryKey:  qk.logs.errors(),
    queryFn:   () => fetchErrorLogs(2),
    staleTime: STALE.live,
  })
}

export function useClearErrorLogs() {
  return useMutationWithFeedback({
    action:         'clear_error_logs',
    successMessage: 'Logs cleared',
    mutationFn:     clearErrorLogs,
    invalidates:    [qk.logs.errors()],
  })
}

export function useAuditLogs(filter: AuditLogFilter) {
  return useQuery({
    queryKey:  qk.logs.audit(filter),
    queryFn:   () => fetchAuditLogs(filter),
    staleTime: STALE.live,
  })
}

export function useClearAuditLogs() {
  return useMutationWithFeedback({
    action:         'clear_audit_logs',
    successMessage: 'Activity log cleared',
    mutationFn:     clearAuditLogs,
    invalidates:    [qk.logs.audit()],
  })
}

/** Recent activity for one project (its row, phases and items). */
export function useProjectActivity(projectId: string, itemIds: string[], phaseIds: string[]) {
  return useQuery({
    // The id lists are part of the key so a new item/phase refetches the feed.
    queryKey:  [...qk.logs.projectActivity(projectId), itemIds.length, phaseIds.length] as const,
    queryFn:   () => fetchProjectActivity(projectId, itemIds, phaseIds),
    staleTime: STALE.live,
  })
}
