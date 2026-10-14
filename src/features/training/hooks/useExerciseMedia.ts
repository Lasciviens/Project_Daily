import { useMemo } from 'react'
import { chooseExerciseMedia, type ExerciseMediaChoice } from '../exerciseGifResolver'
import { useExerciseGifOverrides } from './useExerciseGifOverrides'
import { useExerciseImageDb } from './useExerciseImageDb'
import { useHevyExerciseThumbnails } from './useHevyExerciseTemplates'

/** Hevy's picture, the GIF override and the name-matched GIF of one
 *  exercise, in the order `chooseExerciseMedia` decides (Hevy first). */
export function useExerciseMedia(templateId: string, title: string): ExerciseMediaChoice {
  const { data: db } = useExerciseImageDb()
  const { data: overrides } = useExerciseGifOverrides()
  const { data: hevyThumbs } = useHevyExerciseThumbnails()
  const overridesByTemplateId = useMemo(() => new Map((overrides ?? []).map(o => [o.exercise_template_id, o.gif_url])), [overrides])
  const hevyUrl = hevyThumbs?.[templateId] ?? null
  return useMemo(() => chooseExerciseMedia(templateId, title, hevyUrl, overridesByTemplateId, db), [templateId, title, hevyUrl, overridesByTemplateId, db])
}
