import { useMemo, useState } from 'react'
import { format } from 'date-fns'
import { todayStr } from '../../../../shared/utils/dateUtils'
import { InfoBubble } from '../../../../shared/components/InfoBubble'
import { ExerciseThumb } from '../../exerciseMedia'
import { ROLE_BADGE, ROLE_LABEL, daysAgoText, type ExerciseHit } from './muscleVolumeModel'
import { Truncate } from '../../../../shared/ui'

/** "Which exercises trained it", with a GIF peek per row. */
export function MuscleExerciseList({ exercises }: { exercises: [string, ExerciseHit][] }) {
  const [peek, setPeek] = useState<string | null>(null)
  // Hover devices open the GIF peek on hover; touch devices on tap. Binding
  // both fired a synthetic mouseenter+click on touch → open-then-close flicker.
  const hoverCapable = useMemo(() => typeof window !== 'undefined' && !!window.matchMedia?.('(hover: hover)').matches, [])
  if (exercises.length === 0) return null
  return (
    <div>
      <p className="section-label mb-1.5 flex items-center gap-1">
        Which exercises trained it
        <InfoBubble><p>Full badge = this exercise mainly works this muscle. Half badge = this muscle just assists here, so it counts as half a set toward the weekly total. Hover/tap a row for its demo & last-trained date.</p></InfoBubble>
      </p>
      <ul className="flex flex-col gap-1.5">
        {exercises.map(([name, hit]) => {
          const open = peek === name
          return (
            <li key={name}
              {...(hoverCapable
                ? { onMouseEnter: () => setPeek(name), onMouseLeave: () => setPeek(p => (p === name ? null : p)) }
                : { onClick: () => setPeek(p => (p === name ? null : name)) })}
              className="cursor-pointer rounded-row transition-colors hover:bg-surface-hover">
              <div className="flex min-h-[44px] items-center justify-between gap-2 px-1 py-1 text-body">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-micro font-bold uppercase ${ROLE_BADGE[hit.role]}`}>{ROLE_LABEL[hit.role]}</span>
                  {/* The row opens a peek that shows the whole name. */}
                  <Truncate reveal="none" className="text-fg-2">{name}</Truncate>
                </span>
                <span className="flex shrink-0 items-center gap-1.5 text-meta tabular-nums text-fg-muted">
                  {hit.sets} set{hit.sets !== 1 ? 's' : ''}
                  <span className="text-fg-faint" aria-hidden>{open ? '▾' : '▸'}</span>
                </span>
              </div>
              {open && hit.lastDate && (
                <div className="flex items-center gap-3 px-2 pb-2 pt-0.5">
                  <ExerciseThumb title={name} templateId={hit.templateId} size={64} />
                  <div className="text-meta text-fg-muted">
                    <p className="font-medium text-fg-2">{name}</p>
                    <p>Last trained {daysAgoText(hit.lastDate, todayStr())}</p>
                    <p className="tabular-nums">{format(new Date(`${hit.lastDate}T00:00:00`), 'EEE d MMM')}</p>
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
