import { useState, useMemo } from 'react'
import { useHevyExerciseTemplates } from '../hooks/useHevyExerciseTemplates'
import { ExerciseThumb, ExerciseGifPicker } from '../exerciseMedia'
import type { HevyExerciseTemplate } from '../types.hevy'

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
    <span className="inline-block text-[10px] font-semibold bg-ink-100 text-ink-500 rounded-full px-2 py-0.5 shrink-0 whitespace-nowrap">
      {humanizeType(type)}
    </span>
  )
}

function TemplateCard({ t }: { t: HevyExerciseTemplate }) {
  const muscles = t.secondary_muscle_groups ?? []
  return (
    <div className="flex flex-col gap-2 p-3.5 bg-cream-50 border border-ink-100 rounded-xl hover:border-accent-300 hover:shadow-sm transition-all">
      <div className="flex items-start gap-2.5">
        <ExerciseThumb title={t.title} templateId={t.id} size={64} />
        <div className="flex-1 min-w-0 flex items-start justify-between gap-2">
          <span className="text-sm font-semibold text-ink-800 leading-snug">{t.title}</span>
          <TypeChip type={t.type} />
        </div>
      </div>
      <ExerciseGifPicker templateId={t.id} title={t.title} />
      <div className="flex flex-wrap items-center gap-1">
        {t.primary_muscle_group && (
          <span className="text-[10px] font-medium bg-accent-100 text-accent-700 rounded-full px-2 py-0.5 capitalize">
            {t.primary_muscle_group}
          </span>
        )}
        {muscles.map(m => (
          <span
            key={m}
            className="text-[10px] bg-cream-100 text-ink-500 border border-ink-200 rounded-full px-2 py-0.5 capitalize"
          >
            {m}
          </span>
        ))}
      </div>
    </div>
  )
}

function MuscleGroup({ name, templates, forceOpen }: { name: string; templates: HevyExerciseTemplate[]; forceOpen?: boolean }) {
  const [open, setOpen] = useState(false)
  const isOpen = forceOpen || open

  return (
    <div className="border border-ink-200 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2 min-h-[44px] bg-cream-50 hover:bg-cream-100 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-ink-800 capitalize">{name}</span>
          <span className="text-xs font-semibold bg-ink-200 text-ink-600 rounded-full px-2 py-0.5">
            {templates.length}
          </span>
        </div>
        <span className="text-ink-400 text-xs">{isOpen ? '▲' : '▼'}</span>
      </button>
      {isOpen && (
        <div className="p-2.5 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-2.5 bg-cream-50 border-t border-ink-100">
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
        className="w-full min-h-[44px] bg-cream-50 border border-ink-200 rounded-xl px-4 text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-accent-400"
      />

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-12 rounded-xl bg-cream-200 animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-ink-200 rounded-xl">
          <p className="text-ink-400 text-sm">
            {search ? 'No exercises match your search' : 'No templates yet — sync your Hevy data first'}
          </p>
        </div>
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
