// Recipe ingredient units that can be counted against the library's per-100 g
// values, as grams per unit (ml counts as g). Mirrored by migration 123's
// public.food_unit_grams() — change both together.
const GRAMS_PER_UNIT: Record<string, number> = {
  g: 1, gr: 1, gram: 1, grams: 1, gramm: 1,
  kg: 1000, kilo: 1000, kilogram: 1000, kilograms: 1000,
  ml: 1, milliliter: 1, milliliters: 1, millilitre: 1, millilitres: 1,
  cl: 10, dl: 100,
  l: 1000, liter: 1000, liters: 1000, litre: 1000, litres: 1000,
}

/** Grams in one of this unit, or null when it can't be counted (pieces, cups, to taste…). */
export function gramsPerUnit(unit: string | null | undefined): number | null {
  if (!unit) return null
  return GRAMS_PER_UNIT[unit.trim().toLowerCase()] ?? null
}

/** A quantity in grams, or null when the unit can't be counted. */
export function toGrams(quantity: number | null | undefined, unit: string | null | undefined): number | null {
  const k = gramsPerUnit(unit)
  return k == null || quantity == null ? null : quantity * k
}
