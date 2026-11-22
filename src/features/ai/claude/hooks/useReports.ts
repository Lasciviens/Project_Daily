import { useQuery } from '@tanstack/react-query'
import { qk, STALE } from '../../../../shared/query'
import { fetchLatestReadyReport, fetchReport, fetchReportCosts, fetchReports } from '../reportApi'

// The weekly reports' reads (Home's card reads the newest one; the buttons are in useReportActions.ts).

export function useReports() {
  return useQuery({ queryKey: qk.aiReports.list(), queryFn: () => fetchReports(), staleTime: STALE.short })
}

/** The newest finished report: Home's card. A failed read leaves no card (the card is only ever an addition). */
export function useLatestReport() {
  return useQuery({ queryKey: qk.aiReports.latest(), queryFn: fetchLatestReadyReport, staleTime: STALE.default })
}

export function useReport(id: string | null) {
  return useQuery({ queryKey: qk.aiReports.one(id ?? ''), queryFn: () => fetchReport(id as string), staleTime: STALE.default, enabled: !!id })
}

/** What the reports cost, by their ledger rows (batch price). */
export function useReportCosts(callIds: readonly string[]) {
  const key = [...callIds].sort().join(',')
  return useQuery({ queryKey: qk.aiReports.costs(key), queryFn: () => fetchReportCosts(callIds), staleTime: STALE.short, enabled: callIds.length > 0 })
}
