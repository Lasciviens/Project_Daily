import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchIngredientLibrary, createIngredientLibraryItem, deleteIngredientLibraryItem } from '../api/ingredientLibraryApi'
import type { CreateIngredientLibraryItemInput } from '../types'

export function useIngredientLibrary() {
  return useQuery({
    queryKey:  ['recipe-ingredient-library'],
    queryFn:   fetchIngredientLibrary,
    staleTime: 5 * 60_000,
  })
}

export function useCreateIngredientLibraryItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateIngredientLibraryItemInput) => createIngredientLibraryItem(input),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['recipe-ingredient-library'] }),
  })
}

export function useDeleteIngredientLibraryItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteIngredientLibraryItem(id),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['recipe-ingredient-library'] }),
  })
}
