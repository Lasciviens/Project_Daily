import { useState } from 'react'
import { ModalShell } from '../../../shared/modals'
import type { EntityModalProps } from '../../../shared/modals/types'
import { SkeletonText } from '../../../shared/ui'
import { useMotion } from '../../../shared/hooks/useMotion'
import { useHevyExerciseTemplate } from '../hooks/useHevyExerciseTemplates'
import { ExerciseHevyStill, ExerciseTopPicture } from '../exerciseMedia'
import { chooseExercisePopupPictures } from '../exerciseGifResolver'
import { useExerciseMedia } from '../hooks/useExerciseMedia'
import { ExerciseHevyHistory } from '../components/ExerciseHevyHistory'
import { exerciseTypeLabel, muscleLabel } from '../hevyEnums'

/**
 * `exercise`: one exercise, opened from any of its pictures (Exercises,
 * Routines, Next, the session popup, Muscles, Progress) or its name on the
 * Exercises tab. The animated demo on top with its source and instructions
 * (under Reduce Motion a still with "Play animation"), the type and muscle
 * chips, "History from Hevy" open (3 months), then Hevy's still, small
 * (owner, 25.10.2026: "Hevy picture below, and GIF above"). Loads the
 * template by id; one the library here doesn't have yet still opens with
 * the title it was opened with.
 */
export function ExerciseEntityModal({ request, onClose }: EntityModalProps<'exercise'>) {
  const { templateId } = request
  const template = useHevyExerciseTemplate(templateId)
  const t = template.data ?? null
  const title = t?.title ?? request.title ?? 'Exercise'
  const media = useExerciseMedia(templateId, title)
  const motion = useMotion()
  // The URLs that failed to load: each one leaves, the rest stay.
  const [failed, setFailed] = useState<string[]>([])
  const [played, setPlayed] = useState(false)
  const pictures = chooseExercisePopupPictures(media, { reduceMotion: !motion, played, failed })
  const fail = (url: string) => setFailed(f => (f.includes(url) ? f : [...f, url]))
  const secondary = t?.secondary_muscle_groups ?? []

  return (
    <ModalShell onClose={onClose} title={title} size="md">
      <div className="flex flex-col gap-3">
        <ExerciseTopPicture pictures={pictures} demo={media.demo} title={title} onFail={fail} onPlay={() => setPlayed(true)} />
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
        {pictures.below && <ExerciseHevyStill url={pictures.below} title={title} onFail={fail} />}
      </div>
    </ModalShell>
  )
}
