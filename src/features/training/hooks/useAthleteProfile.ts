import { useQuery } from '@tanstack/react-query'
import { qk, STALE } from '../../../shared/query'
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
const PROFILE_KEY = qk.athlete.profile
const LIMITATIONS_BASE_KEY = qk.athlete.limitations

export function limitationsKey(activeOnly = false) {
  return [...LIMITATIONS_BASE_KEY, activeOnly] as const
}

export function useAthleteProfile() {
  return useQuery({ queryKey: PROFILE_KEY, queryFn: fetchAthleteProfile, staleTime: STALE.default })
}

export function useUpsertAthleteProfile() {
  return useMutationWithFeedback({
    action:         'upsert_athlete_profile',
    successMessage: 'Profile saved',
    mutationFn:     (input: UpsertAthleteProfileInput) => upsertAthleteProfile(input),
    invalidates:    [PROFILE_KEY],
  })
}

export function useAthleteLimitations(activeOnly = false) {
  return useQuery({
    queryKey: limitationsKey(activeOnly),
    queryFn:  () => fetchAthleteLimitations(activeOnly),
    staleTime: STALE.default,
  })
}

export function useCreateLimitation() {
  return useMutationWithFeedback({
    action:         'create_athlete_limitation',
    successMessage: 'Limitation added',
    mutationFn:     (input: CreateLimitationInput) => createAthleteLimitation(input),
    invalidates:    [LIMITATIONS_BASE_KEY],
  })
}

export function useUpdateLimitation() {
  return useMutationWithFeedback({
    action:     'update_athlete_limitation',
    mutationFn: ({ id, patch }: { id: string; patch: UpdateLimitationInput }) => updateAthleteLimitation(id, patch),
    invalidates:    [LIMITATIONS_BASE_KEY],
  })
}

export function useDeleteLimitation() {
  return useMutationWithFeedback({
    action:         'delete_athlete_limitation',
    successMessage: 'Limitation removed',
    mutationFn:     (id: string) => deleteAthleteLimitation(id),
    invalidates:    [LIMITATIONS_BASE_KEY],
  })
}

// ─── Current program (explicit, never inferred) ─────────────────────────────
const CURRENT_PROGRAM_KEY = qk.training.currentProgram

export function useCurrentProgramRoutines() {
  return useQuery({ queryKey: CURRENT_PROGRAM_KEY, queryFn: fetchCurrentProgramRoutines, staleTime: STALE.default })
}

export function useSetCurrentProgramRoutines() {
  return useMutationWithFeedback({
    action:         'set_current_program_routines',
    successMessage: 'Current program saved',
    mutationFn:     (routineIds: string[]) => setCurrentProgramRoutines(routineIds),
    invalidates:    [CURRENT_PROGRAM_KEY],
  })
}

// ─── Muscle preferences ──────────────────────────────────────────────────────
const MUSCLE_PREFS_KEY = qk.athlete.musclePrefs

export function useMusclePreferences() {
  return useQuery({ queryKey: MUSCLE_PREFS_KEY, queryFn: fetchMusclePreferences, staleTime: STALE.default })
}

export function useUpsertMusclePreference() {
  return useMutationWithFeedback({
    action:         'upsert_muscle_preference',
    successMessage: 'Saved',
    mutationFn:     (input: UpsertMusclePreferenceInput) => upsertMusclePreference(input),
    invalidates:    [MUSCLE_PREFS_KEY],
  })
}

export function useDeleteMusclePreference() {
  return useMutationWithFeedback({
    action:         'delete_muscle_preference',
    successMessage: 'Removed',
    mutationFn:     (muscleSlug: string) => deleteMusclePreference(muscleSlug),
    invalidates:    [MUSCLE_PREFS_KEY],
  })
}

// ─── Exercise target overrides ───────────────────────────────────────────────
const EXERCISE_TARGETS_KEY = qk.training.exerciseTargets

export function useExerciseTargetOverrides() {
  return useQuery({ queryKey: EXERCISE_TARGETS_KEY, queryFn: fetchExerciseTargetOverrides, staleTime: STALE.default })
}

export function useUpsertExerciseTargetOverride() {
  return useMutationWithFeedback({
    action:         'upsert_exercise_target_override',
    successMessage: 'Target saved',
    mutationFn:     (input: UpsertExerciseTargetInput) => upsertExerciseTargetOverride(input),
    invalidates:    [EXERCISE_TARGETS_KEY],
  })
}

export function useDeleteExerciseTargetOverride() {
  return useMutationWithFeedback({
    action:         'delete_exercise_target_override',
    successMessage: 'Target removed',
    mutationFn:     (exerciseTemplateId: string) => deleteExerciseTargetOverride(exerciseTemplateId),
    invalidates:    [EXERCISE_TARGETS_KEY],
  })
}
