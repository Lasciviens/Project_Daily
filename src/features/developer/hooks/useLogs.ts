import { useQuery } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { qk, STALE } from '../../../shared/query'
import {
  fetchErrorLogs, clearErrorLogs, fetchAuditLogs, clearAuditLogs,
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
    silent:         'the delete flow reports the result',
    mutationFn:     async () => { await clearErrorLogs(); return true },
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
    silent:         'the delete flow reports the result',
    mutationFn:     async () => { await clearAuditLogs(); return true },
    invalidates:    [qk.logs.audit()],
  })
}
