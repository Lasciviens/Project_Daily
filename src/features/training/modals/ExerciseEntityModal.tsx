import { useState } from 'react'
import { ModalShell } from '../../../shared/modals'
import type { EntityModalProps } from '../../../shared/modals/types'
import { SkeletonText } from '../../../shared/ui'
import { useHevyExerciseTemplate } from '../hooks/useHevyExerciseTemplates'
import { ExerciseDemo } from '../exerciseMedia'
import { useExerciseMedia } from '../hooks/useExerciseMedia'
import { ExerciseHevyHistory } from '../components/ExerciseHevyHistory'
import { exerciseTypeLabel, muscleLabel } from '../hevyEnums'

/**
 * `exercise`: one exercise, opened from any of its pictures (Exercises,
 * Routines, Next, the session popup, Muscles, Progress) or its name on the
 * Exercises tab. Hevy's picture on top (owner: "primarily Hevy") with the
 * type and muscle chips, "History from Hevy" open (3 months), then the small
 * labelled animated demo. Loads the template by id; one the library here
 * doesn't have yet still opens with the title it was opened with.
 */
export function ExerciseEntityModal({ request, onClose }: EntityModalProps<'exercise'>) {
  const { templateId } = request
  const template = useHevyExerciseTemplate(templateId)
  const t = template.data ?? null
  const title = t?.title ?? request.title ?? 'Exercise'
  const media = useExerciseMedia(templateId, title)
  const [brokenPicture, setBrokenPicture] = useState<string | null>(null)
  const picture = media.hevyUrl && media.hevyUrl !== brokenPicture ? media.hevyUrl : null
  const secondary = t?.secondary_muscle_groups ?? []

  return (
    <ModalShell onClose={onClose} title={title} size="md">
      <div className="flex flex-col gap-3">
        {picture && (
          <img src={picture} alt={title} onError={() => setBrokenPicture(picture)}
            className="mx-auto h-36 w-full max-w-xs rounded-row border border-line bg-surface-2 object-contain" />
        )}
        {template.isPending ? (
          <SkeletonText lines={1} />
        ) : t ? (
          <div className="flex min-w-0 flex-wrap items-center gap-1">
            <span className="chip">{exerciseTypeLabel(t.type)}</span>
            {t.primary_muscle_group && (
              <span className="chip border-transparent bg-surface-hover font-semibold text-fg">{muscleLabel(t.primary_muscle_group)}</span>
            )}
            {secondary.map(m => <span key={m} className="chip text-fg-muted">{muscleLabel(m)}</span>)}
            {t.is_custom && <span className="chip text-fg-muted">Custom</span>}
          </div>
        ) : (
          <p className="text-meta text-fg-muted">
            {template.isError ? "Couldn't load this exercise's details." : 'Not in the exercise library here yet — it comes with the next Sync.'}
          </p>
        )}
        <ExerciseHevyHistory templateId={templateId} exerciseType={t?.type} />
        {media.demo && <ExerciseDemo demo={media.demo} title={title} />}
      </div>
    </ModalShell>
  )
}
