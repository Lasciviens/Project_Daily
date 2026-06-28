import { useState, useMemo } from 'react'
import { useHevyExerciseTemplates } from '../hooks/useHevyExerciseTemplates'
import type { HevyExerciseTemplate } from '../types.hevy'

const TYPE_LABELS: Record<HevyExerciseTemplate['type'], string> = {
  weight_reps:          'Weight × Reps',
  bodyweight_reps:      'Bodyweight',
  weighted_bodyweight:  'Weighted BW',
  assisted_bodyweight:  'Assisted BW',
  duration:             'Duration',
  distance_duration:    'Distance',
  weight_distance:      'Weight × Dist',
}

function TypeChip({ type }: { type: HevyExerciseTemplate['type'] }) {
  return (
    <span className="inline-block text-[10px] font-semibold bg-ink-100 text-ink-500 rounded-full px-2 py-0.5 shrink-0">
      {TYPE_LABELS[type] ?? type}
    </span>
  )
}

function TemplateCard({ t }: { t: HevyExerciseTemplate }) {
  return (
    <div className="flex flex-col gap-1 p-2.5 bg-white border border-ink-100 rounded-xl hover:border-ink-200 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-semibold text-ink-800 leading-snug">{t.title}</span>
        <TypeChip type={t.type} />
      </div>
      {(t.secondary_muscle_groups?.length ?? 0) > 0 && (
        <div className="flex flex-wrap gap-1">
          {t.secondary_muscle_groups!.map(m => (
            <span
              key={m}
              className="text-[10px] bg-accent-50 text-accent-700 border border-accent-200 rounded-full px-2 py-0.5 capitalize"
            >
              {m}
            </span>
          ))}
        </div>
      )}
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
        <div className="p-2 grid grid-cols-1 md:grid-cols-2 gap-1.5 bg-cream-50 border-t border-ink-100">
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
