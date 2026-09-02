import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import {
  fetchAthleteProfile,
  upsertAthleteProfile,
  fetchAthleteLimitations,
  createAthleteLimitation,
  updateAthleteLimitation,
  deleteAthleteLimitation,
  fetchCurrentProgramRoutines,
  setCurrentProgramRoutines,
  fetchMusclePreferences,
  upsertMusclePreference,
  deleteMusclePreference,
  fetchExerciseTargetOverrides,
  upsertExerciseTargetOverride,
  deleteExerciseTargetOverride,
} from '../api/athleteProfileApi'
import type {
  UpsertAthleteProfileInput, CreateLimitationInput, UpdateLimitationInput,
  UpsertMusclePreferenceInput, UpsertExerciseTargetInput,
} from '../types.athlete'

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

// ─── Current program (explicit, never inferred) ─────────────────────────────
const CURRENT_PROGRAM_KEY = ['current-program-routines'] as const

export function useCurrentProgramRoutines() {
  return useQuery({ queryKey: CURRENT_PROGRAM_KEY, queryFn: fetchCurrentProgramRoutines })
}

export function useSetCurrentProgramRoutines() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action:         'set_current_program_routines',
    successMessage: 'Current program saved',
    mutationFn:     (routineIds: string[]) => setCurrentProgramRoutines(routineIds),
    onSuccess:      () => qc.invalidateQueries({ queryKey: CURRENT_PROGRAM_KEY }),
  })
}

// ─── Muscle preferences ──────────────────────────────────────────────────────
const MUSCLE_PREFS_KEY = ['athlete-muscle-preferences'] as const

export function useMusclePreferences() {
  return useQuery({ queryKey: MUSCLE_PREFS_KEY, queryFn: fetchMusclePreferences })
}

export function useUpsertMusclePreference() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action:         'upsert_muscle_preference',
    successMessage: 'Saved',
    mutationFn:     (input: UpsertMusclePreferenceInput) => upsertMusclePreference(input),
    onSuccess:      () => qc.invalidateQueries({ queryKey: MUSCLE_PREFS_KEY }),
  })
}

export function useDeleteMusclePreference() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action:         'delete_muscle_preference',
    successMessage: 'Removed',
    mutationFn:     (muscleSlug: string) => deleteMusclePreference(muscleSlug),
    onSuccess:      () => qc.invalidateQueries({ queryKey: MUSCLE_PREFS_KEY }),
  })
}

// ─── Exercise target overrides ───────────────────────────────────────────────
const EXERCISE_TARGETS_KEY = ['exercise-target-overrides'] as const

export function useExerciseTargetOverrides() {
  return useQuery({ queryKey: EXERCISE_TARGETS_KEY, queryFn: fetchExerciseTargetOverrides })
}

export function useUpsertExerciseTargetOverride() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action:         'upsert_exercise_target_override',
    successMessage: 'Target saved',
    mutationFn:     (input: UpsertExerciseTargetInput) => upsertExerciseTargetOverride(input),
    onSuccess:      () => qc.invalidateQueries({ queryKey: EXERCISE_TARGETS_KEY }),
  })
}

export function useDeleteExerciseTargetOverride() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action:         'delete_exercise_target_override',
    successMessage: 'Target removed',
    mutationFn:     (exerciseTemplateId: string) => deleteExerciseTargetOverride(exerciseTemplateId),
    onSuccess:      () => qc.invalidateQueries({ queryKey: EXERCISE_TARGETS_KEY }),
  })
}
