import { useQuery } from '@tanstack/react-query'
import { fetchBodyCompositionReports } from '../api/bodyCompositionApi'

// Whole history, not a windowed fetch — scans are sparse (at most one a day
// in practice) and the panel itself offers 30d/90d/1Y/All windows client-side
// (bodyCompositionAggregate.ts's reportsInWindow), so one full-history fetch
// serves every window without a re-query per toggle.
export function useBodyCompositionReports() {
  return useQuery({
    queryKey: ['body-composition-reports'],
    queryFn:  fetchBodyCompositionReports,
    staleTime: 5 * 60_000,
  })
}
