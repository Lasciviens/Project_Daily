import { useQuery } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { useRowsDelete } from '../../../shared/hooks/useRowsDelete'
import { qk, STALE } from '../../../shared/query'
import {
  fetchTransitRoutes, insertTransitRoute, updateTransitRouteLabel,
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
  const remove = useRowsDelete({ table: 'user_transit_routes', action: 'remove_transit_route', invalidates: INVALIDATES, cache: qk.transit.routes() })
  const rename = useMutationWithFeedback({
    action: 'rename_transit_route',
    successMessage: 'Route renamed',
    mutationFn: ({ id, label }: { id: string; label: string }) => updateTransitRouteLabel(id, label),
    invalidates: INVALIDATES,
  })

  // Errors are toasted by the mutations; these reject only so a caller can stop its flow.
  return {
    routes,
    isLoading,
    addRoute:    (label: string, from: StopResult, to: StopResult) => add.mutateAsync({ label, from, to }),
    /** Asks, removes, "Route removed · Undo". */
    removeRoute: (id: string, name: string) => remove.run([id], { title: `Remove ${name}?`, confirmLabel: 'Remove', done: 'Route removed' }),
    updateLabel: (id: string, label: string) => rename.mutateAsync({ id, label }),
  }
}
