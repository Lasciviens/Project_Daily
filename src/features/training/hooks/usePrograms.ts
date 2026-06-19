import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchPrograms, createProgram, updateProgram, deleteProgram,
  fetchProgramWorkouts, createProgramWorkout, updateProgramWorkout, deleteProgramWorkout,
  fetchProgramExercises, saveProgramExercises,
} from '../api/trainingApi'
import type { ProgramWorkoutExercise } from '../types'

export function usePrograms() {
  return useQuery({
    queryKey: ['training', 'programs'],
    queryFn:  fetchPrograms,
    staleTime: 5 * 60_000,
  })
}

export function useCreateProgram() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ name, description }: { name: string; description?: string }) =>
      createProgram(name, description),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['training', 'programs'] }),
  })
}

export function useUpdateProgram() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { name?: string; description?: string } }) =>
      updateProgram(id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['training', 'programs'] }),
  })
}

export function useDeleteProgram() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteProgram(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['training', 'programs'] }),
  })
}

export function useProgramWorkouts(programId: string | undefined) {
  return useQuery({
    queryKey: ['training', 'program-workouts', programId],
    queryFn:  () => fetchProgramWorkouts(programId!),
    enabled:  !!programId,
    staleTime: 5 * 60_000,
  })
}

export function useCreateProgramWorkout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ programId, name }: { programId: string; name: string }) =>
      createProgramWorkout(programId, name),
    onSuccess: (_, { programId }) =>
      qc.invalidateQueries({ queryKey: ['training', 'program-workouts', programId] }),
  })
}

export function useUpdateProgramWorkout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { name?: string }; programId: string }) =>
      updateProgramWorkout(id, patch),
    onSuccess: (_, { programId }) =>
      qc.invalidateQueries({ queryKey: ['training', 'program-workouts', programId] }),
  })
}

export function useDeleteProgramWorkout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id }: { id: string; programId: string }) => deleteProgramWorkout(id),
    onSuccess: (_, { programId }) =>
      qc.invalidateQueries({ queryKey: ['training', 'program-workouts', programId] }),
  })
}

export function useProgramExercises(workoutId: string | undefined) {
  return useQuery({
    queryKey: ['training', 'program-exercises', workoutId],
    queryFn:  () => fetchProgramExercises(workoutId!),
    enabled:  !!workoutId,
    staleTime: 5 * 60_000,
  })
}

export function useSaveProgramExercises() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      workoutId,
      exercises,
    }: {
      workoutId: string
      exercises: Omit<ProgramWorkoutExercise, 'id' | 'workout_id'>[]
    }) => saveProgramExercises(workoutId, exercises),
    onSuccess: (_, { workoutId }) =>
      qc.invalidateQueries({ queryKey: ['training', 'program-exercises', workoutId] }),
  })
}
