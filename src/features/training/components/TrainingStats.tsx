import { useState } from 'react'
import type { TrainingSession } from '../types'

interface Props {
  sessions: TrainingSession[]
}

function StatBox({ label, value, icon }: { label: string; value: string | number; icon: string }) {
  return (
    <div className="text-center p-2.5 rounded-xl bg-white border border-ink-100">
      <div className="text-xl mb-0.5">{icon}</div>
      <div className="text-base font-bold text-ink-900">{value}</div>
      <div className="text-[10px] text-ink-400 leading-tight">{label}</div>
    </div>
  )
}

export function TrainingStats({ sessions }: Props) {
  const [open, setOpen] = useState(false)
  if (!sessions.length) return null

  const done     = sessions.filter(s => s.completed_at)
  const runs     = done.filter(s => s.type === 'run')
  const strength = done.filter(s => s.type === 'strength')

  const totalMinutes  = done.reduce((s, e) => s + (e.duration_seconds ?? 0), 0) / 60
  const totalKm       = runs.reduce((s, e) => s + (e.distance_meters ?? 0), 0) / 1000
  const avgHR         = runs.filter(s => s.avg_heart_rate).reduce((s, e, _, a) =>
    s + (e.avg_heart_rate ?? 0) / a.length, 0)

  // Last 30 days
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 30)
  const recent  = done.filter(s => s.completed_at && new Date(s.completed_at) > cutoff)

  return (
    <div className="mb-6">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 mb-3 w-full text-left"
      >
        <span className="text-xs font-semibold uppercase tracking-wider text-ink-500">
          📊 Stats
        </span>
        <span className={`ml-auto text-ink-400 text-xs transition-transform duration-150 ${open ? 'rotate-0' : '-rotate-90'}`}>
          ▾
        </span>
      </button>

      {open && (
        <div className="space-y-4 rounded-xl border border-ink-100 bg-cream-50 p-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatBox label="Total workouts"   value={done.length}                      icon="💪" />
            <StatBox label="Hours trained"    value={`${Math.round(totalMinutes / 60)}h`} icon="⏱" />
            <StatBox label="Km run"           value={totalKm.toFixed(1)}               icon="🏃" />
            <StatBox label="Strength sessions" value={strength.length}                 icon="🏋️" />
          </div>

          {avgHR > 0 && (
            <p className="text-xs text-ink-500">
              <span className="font-medium">Avg run HR:</span> {Math.round(avgHR)} bpm
            </p>
          )}

          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-400 mb-2">Last 30 days</p>
            <div className="flex gap-1 items-end h-8">
              {Array.from({ length: 30 }, (_, i) => {
                const d = new Date(); d.setDate(d.getDate() - (29 - i))
                const ds = d.toISOString().slice(0, 10)
                const count = recent.filter(s =>
                  (s.planned_date ?? s.completed_at?.slice(0, 10)) === ds
                ).length
                return (
                  <div
                    key={i}
                    title={ds}
                    className={`flex-1 rounded-sm transition-all ${count > 0 ? 'bg-accent-400' : 'bg-ink-100'}`}
                    style={{ height: count > 0 ? `${Math.min(100, count * 50)}%` : '20%' }}
                  />
                )
              })}
            </div>
            <p className="text-[9px] text-ink-400 mt-1">{recent.length} sessions in the last 30 days</p>
          </div>
        </div>
      )}
    </div>
  )
}
