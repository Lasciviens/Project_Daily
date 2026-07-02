export interface RecipeIngredient {
  id:         string
  user_id:    string
  recipe_id:  string
  name:       string
  quantity:   number | null
  unit:       string | null
  note:       string | null
  sort_order: number
}

export interface Recipe {
  id:           string
  user_id:      string
  title:        string
  description:  string | null
  servings:     number
  instructions: string | null
  calories:     number | null
  protein_g:    number | null
  carbs_g:      number | null
  fat_g:        number | null
  image_url:    string | null
  source_url:   string | null
  created_at:   string
  updated_at:   string
}

export interface RecipeWithIngredients extends Recipe {
  ingredients: RecipeIngredient[]
}

// Draft shapes used by the editor before rows have DB ids.
export interface IngredientDraft {
  name:     string
  quantity: number | null
  unit:     string | null
  note:     string | null
}

export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack'

export interface MealPlanEntry {
  id:           string
  user_id:      string
  date:         string          // yyyy-MM-dd
  meal_slot:    MealSlot
  recipe_id:    string | null
  custom_title: string | null
  servings:     number
  notes:        string | null
  created_at:   string
  recipe?:      Pick<Recipe, 'id' | 'title' | 'calories'> | null
}

export interface CreateMealPlanEntryInput {
  date:         string
  meal_slot:    MealSlot
  recipe_id?:   string | null
  custom_title?: string | null
  servings?:    number
  notes?:       string | null
}

export interface RecipeInput {
  title:        string
  description?:  string | null
  servings:     number
  instructions?: string | null
  calories?:    number | null
  protein_g?:   number | null
  carbs_g?:     number | null
  fat_g?:       number | null
  image_url?:   string | null
  source_url?:  string | null
  ingredients:  IngredientDraft[]
}
