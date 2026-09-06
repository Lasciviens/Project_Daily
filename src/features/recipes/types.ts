export type MacroMode = 'manual' | 'from_ingredients'

export type FoodCategory = 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'supplement'
export type MealSlot = FoodCategory

// The 16 top-level Matvaretabellen food groups (drives the Foods filter pills
// + the category select). Matvaretabellen rows are auto-categorized (migration
// 058); hand-made / barcode rows default to null → "Other".
export const FOOD_GROUPS = [
  'Dairy products', 'Egg', 'Meat and poultry', 'Fish and shellfish',
  'Cereals, bread and cakes', 'Vegetables', 'Sugar and sweet products', 'Cooking fat',
  'Beverages', 'Other foods and dishes', 'Infant food', 'Legumes',
  'Fruit and berries', 'Nuts and seeds', 'Potatoes', 'Herbs and spices',
  'Supplements',   // not a Matvaretabellen group — our own bucket for DSLD/creatine/whey rows
] as const
export type FoodGroup = typeof FOOD_GROUPS[number]

export interface IngredientLibraryItem {
  id:            string
  user_id:       string
  name:          string
  unit:          string
  calories:      number | null   // per 100g
  protein_g:     number | null   // per 100g
  carbs_g:       number | null   // per 100g
  fat_g:         number | null   // per 100g
  fiber_g:       number | null   // per 100g
  sugar_g:       number | null   // per 100g
  serving_label: string | null   // e.g. '1 scoop'
  serving_grams: number | null   // grams that label equals
  food_group_id: string | null   // raw Matvaretabellen group id (e.g. '4.1.2')
  food_group:    string | null   // denormalized top-level group name
  image_url:     string | null   // branded product photo (OFF/Kassalapp), migration 059
  source:        string | null   // provenance: 'dsld' | 'openfoodfacts' | 'kassalapp' | null (migration 055)
  source_ref:    string | null   // EAN / DSLD id (migration 055)
  created_at:    string
}

export interface CreateIngredientLibraryItemInput {
  name:           string
  unit?:          string
  calories?:      number | null
  protein_g?:     number | null
  carbs_g?:       number | null
  fat_g?:         number | null
  fiber_g?:       number | null
  sugar_g?:       number | null
  serving_label?: string | null
  serving_grams?: number | null
  food_group?:    string | null
  food_group_id?: string | null
  image_url?:     string | null
  source?:        string | null
  source_ref?:    string | null
}

// One diary row — what was ACTUALLY eaten (vs recipe_meal_plans = the plan).
// Macros are a SNAPSHOT taken at log time; editing the library later never
// rewrites history (migration 053).
export interface FoodLogEntry {
  id:                    string
  user_id:               string
  date:                  string
  meal_slot:             MealSlot
  library_ingredient_id: string | null
  recipe_id:             string | null
  custom_title:          string | null
  quantity:              number | null
  unit:                  string | null
  calories:              number | null
  protein_g:             number | null
  carbs_g:               number | null
  fat_g:                 number | null
  fiber_g:               number | null
  sugar_g:               number | null
  /** Ties several individually-logged rows together as one compact diary
      line ("As meal" in FoodLogModal) — null for a normal single-item or
      recipe log. Migration 087. */
  meal_group_id:         string | null
  created_at:            string
}

export interface FoodLogEntryInput {
  date:                   string
  meal_slot:              MealSlot
  library_ingredient_id?: string | null
  recipe_id?:             string | null
  custom_title?:          string | null
  quantity?:              number | null
  unit?:                  string | null
  calories?:              number | null
  protein_g?:             number | null
  carbs_g?:               number | null
  fat_g?:                 number | null
  fiber_g?:               number | null
  sugar_g?:               number | null
  meal_group_id?:         string | null
}

export interface RecipeIngredient {
  id:                    string
  user_id:               string
  recipe_id:             string
  name:                  string
  quantity:              number | null
  unit:                  string | null
  note:                  string | null
  sort_order:            number
  library_ingredient_id: string | null
}

export interface Recipe {
  id:           string
  user_id:      string
  title:        string
  description:  string | null
  servings:     number
  instructions: string | null
  macro_mode:   MacroMode
  calories:     number | null
  protein_g:    number | null
  carbs_g:      number | null
  fat_g:        number | null
  fiber_g:      number | null
  sugar_g:      number | null
  image_url:    string | null
  source_url:   string | null
  times_cooked: number
  category:     FoodCategory | null
  is_temp:      boolean       // saved from the logger as a one-off named meal → hidden from the Library grid
  created_at:   string
  updated_at:   string
}

export interface RecipeWithIngredients extends Recipe {
  ingredients: RecipeIngredient[]
}

// Draft shapes used by the editor before rows have DB ids.
export interface IngredientDraft {
  name:                  string
  quantity:              number | null
  unit:                  string | null
  note:                  string | null
  library_ingredient_id: string | null
}

export interface MealPlanEntry {
  id:                    string
  user_id:               string
  date:                  string          // yyyy-MM-dd
  meal_slot:             MealSlot
  recipe_id:             string | null
  custom_title:          string | null
  library_ingredient_id: string | null
  ingredient_quantity:   number | null
  ingredient_unit:       string | null
  servings:              number
  notes:                 string | null
  created_at:            string
  recipe?:               Pick<Recipe, 'id' | 'title' | 'calories'> | null
  ingredient?:           Pick<IngredientLibraryItem, 'id' | 'name'> | null
}

export interface CreateMealPlanEntryInput {
  id?:                    string   // present → update that plan row; absent → insert
  date:                   string
  meal_slot:              MealSlot
  recipe_id?:             string | null
  custom_title?:          string | null
  library_ingredient_id?: string | null
  ingredient_quantity?:   number | null
  ingredient_unit?:       string | null
  servings?:              number
  notes?:                 string | null
}

export interface RecipeInput {
  title:         string
  description?:  string | null
  servings:      number
  instructions?: string | null
  macro_mode:    MacroMode
  calories?:     number | null
  protein_g?:    number | null
  carbs_g?:      number | null
  fat_g?:        number | null
  fiber_g?:      number | null
  sugar_g?:      number | null
  image_url?:    string | null
  source_url?:   string | null
  category?:     FoodCategory | null
  is_temp?:      boolean
  ingredients:   IngredientDraft[]
}
