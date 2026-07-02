import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchRecipes, createRecipe, updateRecipe, deleteRecipe } from '../api/recipesApi'
import type { RecipeInput } from '../types'

export function useRecipes() {
  return useQuery({
    queryKey:  ['recipes'],
    queryFn:   fetchRecipes,
    staleTime: 60_000,
  })
}

export function useCreateRecipe() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: RecipeInput) => createRecipe(input),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['recipes'] }),
  })
}

export function useUpdateRecipe() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: RecipeInput }) => updateRecipe(id, input),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['recipes'] }),
  })
}

export function useDeleteRecipe() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteRecipe(id),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['recipes'] }),
  })
}
