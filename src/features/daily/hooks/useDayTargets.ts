import { useState, useEffect, useCallback } from 'react'

// Daily nutrition goals. No DB table for this — single-user, per-browser is
// fine (same rationale as the daily-briefing cache): zero migration, instant.
export type NutritionGoal = 'maintain' | 'cut' | 'gain'

export interface DayTargets {
  calories: number
  protein:  number        // grams
  goal:     NutritionGoal // steers protein g/kg + adaptive-calorie coaching
}

const STORAGE_KEY = 'lasci.dayTargets'
const DEFAULTS: DayTargets = { calories: 2200, protein: 150, goal: 'maintain' }

const GOALS: NutritionGoal[] = ['maintain', 'cut', 'gain']

function read(): DayTargets {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULTS
    const parsed = JSON.parse(raw) as Partial<DayTargets>
    return {
      calories: Number(parsed.calories) || DEFAULTS.calories,
      protein:  Number(parsed.protein)  || DEFAULTS.protein,
      goal:     GOALS.includes(parsed.goal as NutritionGoal) ? (parsed.goal as NutritionGoal) : DEFAULTS.goal,
    }
  } catch {
    return DEFAULTS
  }
}

export function useDayTargets() {
  const [targets, setTargets] = useState<DayTargets>(read)

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(targets)) } catch { /* quota */ }
  }, [targets])

  const update = useCallback((patch: Partial<DayTargets>) => {
    setTargets(t => ({ ...t, ...patch }))
  }, [])

  return { targets, update }
}
