import { useQuery } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { qk, STALE } from '../../../shared/query'
import {
  fetchTransitRoutes, insertTransitRoute, deleteTransitRoute, updateTransitRouteLabel,
  type UserTransitRoute,
} from '../api/transitStoreApi'
import type { StopResult } from '../api/ruterApi'

export type { UserTransitRoute }

const INVALIDATES = [qk.transit.routes()]

export function useTransitRoutes() {
  const { data: routes = [], isLoading } = useQuery({
    queryKey: qk.transit.routes(),
    queryFn:  fetchTransitRoutes,
    staleTime: STALE.default,
  })

  const add = useMutationWithFeedback({
    action: 'add_transit_route', successMessage: 'Route saved',
    mutationFn: ({ label, from, to }: { label: string; from: StopResult; to: StopResult }) =>
      insertTransitRoute(label, from, to, routes.length),
    invalidates: INVALIDATES,
  })
  const remove = useMutationWithFeedback({
    action: 'remove_transit_route', successMessage: 'Route removed',
    mutationFn: deleteTransitRoute, invalidates: INVALIDATES,
  })
  const rename = useMutationWithFeedback({
    action: 'rename_transit_route',
    mutationFn: ({ id, label }: { id: string; label: string }) => updateTransitRouteLabel(id, label),
    invalidates: INVALIDATES,
  })

  // Errors are toasted by the mutations; these reject only so a caller can stop its flow.
  return {
    routes,
    isLoading,
    addRoute:    (label: string, from: StopResult, to: StopResult) => add.mutateAsync({ label, from, to }),
    removeRoute: (id: string) => remove.mutateAsync(id),
    updateLabel: (id: string, label: string) => rename.mutateAsync({ id, label }),
  }
}
