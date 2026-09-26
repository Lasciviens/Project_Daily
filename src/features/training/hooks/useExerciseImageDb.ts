import { useQuery } from '@tanstack/react-query'
import { qk, STALE } from '../../../shared/query'
import { normalizeTokens, type IndexedExercise } from '../exerciseGifResolver'

const GIF_SOURCE = 'https://cdn.jsdelivr.net/gh/JahelCuadrado/ExerciseGymGifsDB@v1.1.0'
const MANIFEST_URL = `${GIF_SOURCE}/api/en/exercises.json`

interface RawExercise {
  name: string
  equipment: string | null
  gifUrl: string
  instructions?: string[]
}

// Fetched + indexed once, cached forever (the dataset is static). Exported so
// the manual-override picker (ExerciseGifPicker) can search the SAME already-loaded
// dataset rather than fetching it a second time.
export function useExerciseImageDb() {
  return useQuery({
    queryKey: qk.training.exerciseGifDb,
    queryFn: async (): Promise<IndexedExercise[]> => {
      const res = await fetch(MANIFEST_URL)
      if (!res.ok) throw new Error(`exercise-gif-db ${res.status}`)
      // Manifest is { count, exercises: [...] } — not a bare array.
      const json = await res.json()
      const raw: RawExercise[] = Array.isArray(json) ? json : (json.exercises ?? [])
      return raw
        .filter(e => e.gifUrl)
        .map(e => ({
          name: e.name,
          tokens: normalizeTokens(e.name).tokens,
          equipment: e.equipment,
          gifUrl: e.gifUrl,
          instructions: e.instructions ?? [],
        }))
    },
    staleTime: STALE.never,
    gcTime: Infinity,
    retry: 1,
  })
}
