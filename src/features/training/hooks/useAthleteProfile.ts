import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import {
  fetchAthleteProfile,
  upsertAthleteProfile,
  fetchAthleteLimitations,
  createAthleteLimitation,
  updateAthleteLimitation,
  deleteAthleteLimitation,
} from '../api/athleteProfileApi'
import type { UpsertAthleteProfileInput, CreateLimitationInput, UpdateLimitationInput } from '../types.athlete'

// One profile row per user + a separate list of limitations. Own query
// namespaces; every mutation invalidates its own so the Training settings UI
// and the coach snapshot (both consumers) stay in sync.
const PROFILE_KEY = ['athlete-profile'] as const
const LIMITATIONS_BASE_KEY = ['athlete-limitations'] as const

export function limitationsKey(activeOnly = false) {
  return [...LIMITATIONS_BASE_KEY, activeOnly] as const
}

export function useAthleteProfile() {
  return useQuery({ queryKey: PROFILE_KEY, queryFn: fetchAthleteProfile })
}

export function useUpsertAthleteProfile() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action:         'upsert_athlete_profile',
    successMessage: 'Profile saved',
    mutationFn:     (input: UpsertAthleteProfileInput) => upsertAthleteProfile(input),
    onSuccess:      () => qc.invalidateQueries({ queryKey: PROFILE_KEY }),
  })
}

export function useAthleteLimitations(activeOnly = false) {
  return useQuery({
    queryKey: limitationsKey(activeOnly),
    queryFn:  () => fetchAthleteLimitations(activeOnly),
  })
}

export function useCreateLimitation() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action:         'create_athlete_limitation',
    successMessage: 'Limitation added',
    mutationFn:     (input: CreateLimitationInput) => createAthleteLimitation(input),
    // Prefix-invalidates every activeOnly variant of the limitations key.
    onSuccess:      () => qc.invalidateQueries({ queryKey: LIMITATIONS_BASE_KEY }),
  })
}

export function useUpdateLimitation() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action:     'update_athlete_limitation',
    mutationFn: ({ id, patch }: { id: string; patch: UpdateLimitationInput }) => updateAthleteLimitation(id, patch),
    onSuccess:  () => qc.invalidateQueries({ queryKey: LIMITATIONS_BASE_KEY }),
  })
}

export function useDeleteLimitation() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action:         'delete_athlete_limitation',
    successMessage: 'Limitation removed',
    mutationFn:     (id: string) => deleteAthleteLimitation(id),
    onSuccess:      () => qc.invalidateQueries({ queryKey: LIMITATIONS_BASE_KEY }),
  })
}
