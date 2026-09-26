import { useState, useMemo } from 'react'
import { useHevyExerciseTemplates } from '../hooks/useHevyExerciseTemplates'
import { ExerciseThumb, ExerciseGifPicker } from '../exerciseMedia'
import type { HevyExerciseTemplate } from '../types.hevy'
import { ChevronDown, Dumbbell } from 'lucide-react'
import { EmptyState, Skeleton } from '../../../shared/ui'

// Friendly labels for Hevy's CustomExerciseType enum. Anything not listed
// falls back to a humanized version (snake_case → "Title Case") so raw values
// like "reps_only" never leak into the UI.
const TYPE_LABELS: Record<string, string> = {
  weight_reps:              'Weight × Reps',
  reps_only:                'Reps',
  bodyweight_reps:          'Bodyweight',
  bodyweight_weighted:      'Weighted BW',
  weighted_bodyweight:      'Weighted BW',
  bodyweight_assisted_reps: 'Assisted BW',
  assisted_bodyweight:      'Assisted BW',
  bodyweight_assisted:      'Assisted BW',
  duration:                 'Duration',
  weight_duration:          'Weight × Time',
  distance_duration:        'Distance × Time',
  short_distance_weight:    'Weighted Distance',
  weight_distance:          'Weight × Dist',
  floors_duration:          'Floors × Time',
  steps_duration:           'Steps × Time',
}

function humanizeType(type: string): string {
  return TYPE_LABELS[type] ?? type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function TypeChip({ type }: { type: string }) {
  return (
    <span className="chip shrink-0">{humanizeType(type)}</span>
  )
}

function TemplateCard({ t }: { t: HevyExerciseTemplate }) {
  const muscles = t.secondary_muscle_groups ?? []
  return (
    <div className="card flex flex-col gap-2 p-3.5">
      <div className="flex items-start gap-2.5">
        <ExerciseThumb title={t.title} templateId={t.id} size={64} />
        <div className="flex-1 min-w-0 flex items-start justify-between gap-2">
          <span className="text-body font-semibold leading-snug text-fg">{t.title}</span>
          <TypeChip type={t.type} />
        </div>
      </div>
      <ExerciseGifPicker templateId={t.id} title={t.title} />
      <div className="flex flex-wrap items-center gap-1">
        {t.primary_muscle_group && (
          <span className="chip border-transparent bg-surface-hover font-semibold capitalize text-fg">{t.primary_muscle_group}</span>
        )}
        {muscles.map(m => (
          <span key={m} className="chip capitalize text-fg-muted">{m}</span>
        ))}
      </div>
    </div>
  )
}

function MuscleGroup({ name, templates, forceOpen }: { name: string; templates: HevyExerciseTemplate[]; forceOpen?: boolean }) {
  const [open, setOpen] = useState(false)
  const isOpen = forceOpen || open

  return (
    <div className="card overflow-hidden">
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => setOpen(o => !o)}
        className="flex min-h-[44px] w-full items-center justify-between px-4 py-2 transition-colors hover:bg-surface-hover"
      >
        <div className="flex items-center gap-2">
          <span className="text-body font-semibold capitalize text-fg">{name}</span>
          <span className="count-badge">{templates.length}</span>
        </div>
        <ChevronDown aria-hidden className={`h-4 w-4 text-fg-faint transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      {isOpen && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(17rem,22rem))] justify-start gap-2.5 border-t border-line bg-surface-2 p-2.5">
          {templates.map(t => (
            <TemplateCard key={t.id} t={t} />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── ExerciseTemplatesTab ─────────────────────────────────────────────────────

export function ExerciseTemplatesTab() {
  const { data: templates = [], isLoading } = useHevyExerciseTemplates()
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    if (!search.trim()) return templates
    const q = search.toLowerCase()
    return templates.filter(t => t.title.toLowerCase().includes(q))
  }, [templates, search])

  const grouped = useMemo(() => {
    const map = new Map<string, HevyExerciseTemplate[]>()
    for (const t of filtered) {
      const key = t.primary_muscle_group ?? 'Other'
      const bucket = map.get(key) ?? []
      bucket.push(t)
      map.set(key, bucket)
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b))
  }, [filtered])

  return (
    <div className="flex flex-col gap-3">
      <input
        type="search"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search exercises…"
        aria-label="Search exercises"
        className="input w-full max-w-md"
      />

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} rounded="rounded-card" className="h-12" />)}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          bordered
          icon={<Dumbbell />}
          title={search ? 'No exercises match your search' : 'No exercise templates yet'}
          description={search ? undefined : 'Sync your Hevy data first.'}
        />
      ) : (
        <div className="flex flex-col gap-2">
          {grouped.map(([name, list]) => (
            <MuscleGroup key={name} name={name} templates={list} forceOpen={!!search.trim()} />
          ))}
        </div>
      )}
    </div>
  )
}
