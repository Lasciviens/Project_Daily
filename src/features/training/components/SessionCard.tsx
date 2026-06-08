import { useState } from 'react'
import { useDeleteSession } from '../hooks/useTrainingSessions'
import { LogWorkoutModal } from './LogWorkoutModal'
import type { TrainingSession, WorkoutType } from '../types'

const TYPE_ICON: Record<WorkoutType, string> = {
  strength: '🏋️',
  run:      '🏃',
  cycling:  '🚴',
  walk:     '🚶',
  yoga:     '🧘',
  swim:     '🏊',
  other:    '💪',
}

const TYPE_COLOR: Record<WorkoutType, string> = {
  strength: 'bg-purple-50 text-purple-700 border-purple-100',
  run:      'bg-green-50 text-green-700 border-green-100',
  cycling:  'bg-blue-50 text-blue-700 border-blue-100',
  walk:     'bg-teal-50 text-teal-700 border-teal-100',
  yoga:     'bg-pink-50 text-pink-700 border-pink-100',
  swim:     'bg-cyan-50 text-cyan-700 border-cyan-100',
  other:    'bg-ink-50 text-ink-600 border-ink-100',
}

function formatPace(secPerKm: number): string {
  const m = Math.floor(secPerKm / 60)
  const s = secPerKm % 60
  return `${m}:${String(s).padStart(2, '0')}/km`
}

function formatDuration(secs: number): string {
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function formatDistance(meters: number): string {
  return meters >= 1000
    ? `${(meters / 1000).toFixed(2)} km`
    : `${meters} m`
}

interface Props {
  session:  TrainingSession
  compact?: boolean
}

export function SessionCard({ session, compact }: Props) {
  const del = useDeleteSession()
  const [showEdit, setShowEdit] = useState(false)
  const icon  = TYPE_ICON[session.type]
  const color = TYPE_COLOR[session.type]

  const date = session.planned_date
    ? new Date(session.planned_date + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    : null

  return (
    <div className="flex items-start gap-3 p-3 rounded-xl border border-ink-100 bg-white hover:border-ink-200 transition-colors duration-150">
      <div className={`w-9 h-9 flex-shrink-0 rounded-lg border flex items-center justify-center text-lg ${color}`}>
        {icon}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium text-ink-800 leading-snug">{session.title}</p>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button
              onClick={() => setShowEdit(true)}
              className="text-ink-300 hover:text-accent-500 transition-colors duration-150 text-xs"
              title="Edit workout"
            >
              ✎
            </button>
            <button
              onClick={() => del.mutate(session.id)}
              disabled={del.isPending}
              className="text-ink-300 hover:text-red-400 transition-colors duration-150 text-xs"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mt-1">
          {date && <span className="text-[10px] text-ink-400">{date}</span>}
          {session.source === 'strava' && (
            <span className="text-[10px] text-[#FC4C02] font-medium">Strava</span>
          )}
          {session.completed_at && !session.planned_date && (
            <span className="text-[10px] text-ink-400">
              {new Date(session.completed_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
            </span>
          )}
        </div>

        {!compact && (
          <div className="flex flex-wrap gap-3 mt-1.5 text-xs text-ink-500">
            {session.duration_seconds != null && (
              <span>⏱ {formatDuration(session.duration_seconds)}</span>
            )}
            {session.distance_meters != null && (
              <span>📍 {formatDistance(session.distance_meters)}</span>
            )}
            {session.avg_pace_sec_per_km != null && (
              <span>⚡ {formatPace(session.avg_pace_sec_per_km)}</span>
            )}
            {session.avg_heart_rate != null && (
              <span>❤️ {session.avg_heart_rate} bpm</span>
            )}
            {session.elevation_gain_m != null && session.elevation_gain_m > 0 && (
              <span>⛰ {session.elevation_gain_m} m</span>
            )}
          </div>
        )}

        {/* Exercises are stored in session_exercises table — visible in detail/edit view */}

        {!compact && session.notes && (
          <p className="mt-1.5 text-xs text-ink-400 italic">{session.notes}</p>
        )}
      </div>

      {showEdit && (
        <LogWorkoutModal session={session} onClose={() => setShowEdit(false)} />
      )}
    </div>
  )
}
