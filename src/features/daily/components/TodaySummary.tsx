import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { isToday } from 'date-fns'
import { useDayNutrition } from '../hooks/useDayNutrition'
import { useDayTargets } from '../hooks/useDayTargets'
import { useTimeBlocks } from '../hooks/useSchedule'
import { useHevyWorkouts } from '../../training/hooks/useHevyWorkouts'
import { useMovies } from '../../media/hooks/useMovies'
import { useTVSeries } from '../../media/hooks/useTVSeries'
import { MacroBar } from '../../recipes/components/MacroBar'
import { posterUrl } from '../../../integrations/tmdb/client'
import { formatLocalDate } from '../../../shared/utils/dateUtils'

// ─────────────────────────────────────────────────────────────────────────────
//  "Today at a glance" — a summary strip above the Daily day layout that pulls
//  the whole day into one view: what to eat + macros vs. target, whether
//  there's training today, and something to watch. Read-only overview; deep
//  edits still live on each feature's own page (links out).
// ─────────────────────────────────────────────────────────────────────────────

const SLOT_LABEL: Record<string, string> = {
  breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack',
}

// ─── Calorie ring (custom SVG donut) ─────────────────────────────────────────

function CalorieRing({ consumed, target }: { consumed: number; target: number }) {
  const pct = target > 0 ? Math.min(consumed / target, 1) : 0
  const R = 34, C = 2 * Math.PI * R
  const remaining = Math.max(target - consumed, 0)
  const over = consumed > target

  return (
    <div className="relative w-[92px] h-[92px] shrink-0">
      <svg viewBox="0 0 80 80" className="w-full h-full -rotate-90">
        <circle cx="40" cy="40" r={R} fill="none" stroke="rgb(var(--ink-100))" strokeWidth="8" />
        <circle
          cx="40" cy="40" r={R} fill="none"
          stroke={over ? '#f87171' : 'rgb(var(--accent-500))'}
          strokeWidth="8" strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={C * (1 - pct)}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-lg font-bold text-ink-900 leading-none">{remaining}</span>
        <span className="text-[9px] text-ink-400 mt-0.5">{over ? 'over' : 'kcal left'}</span>
      </div>
    </div>
  )
}

// ─── Nutrition card ──────────────────────────────────────────────────────────

function NutritionCard({ date }: { date: string }) {
  const { data: nut } = useDayNutrition(date)
  const { targets, update } = useDayTargets()
  const [editing, setEditing] = useState(false)

  const consumed = nut?.calories ?? 0
  const protein  = nut?.protein_g ?? 0
  const proteinPct = targets.protein > 0 ? Math.min(Math.round((protein / targets.protein) * 100), 100) : 0

  return (
    <div className="rounded-2xl border border-ink-200 bg-cream-50 p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-ink-800 flex items-center gap-1.5">🍽️ Nutrition</h3>
        <button
          onClick={() => setEditing(e => !e)}
          className="text-[11px] text-ink-400 hover:text-ink-700 min-h-[28px] px-1.5 rounded transition-colors"
        >
          {editing ? 'Done' : 'Set goals'}
        </button>
      </div>

      {editing ? (
        <div className="flex flex-col gap-2">
          <label className="flex items-center justify-between gap-2 text-xs text-ink-600">
            Calorie goal
            <input
              type="number" value={targets.calories}
              onChange={e => update({ calories: Number(e.target.value) || 0 })}
              className="input w-24 text-sm py-1 text-right" min={0}
            />
          </label>
          <label className="flex items-center justify-between gap-2 text-xs text-ink-600">
            Protein goal (g)
            <input
              type="number" value={targets.protein}
              onChange={e => update({ protein: Number(e.target.value) || 0 })}
              className="input w-24 text-sm py-1 text-right" min={0}
            />
          </label>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-4">
            <CalorieRing consumed={consumed} target={targets.calories} />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-ink-700">
                <strong className="text-ink-900">{consumed}</strong>
                <span className="text-ink-400"> / {targets.calories} kcal</span>
              </p>
              <div className="mt-2">
                <div className="flex items-center justify-between text-[11px] text-ink-500 mb-1">
                  <span>Protein</span>
                  <span><strong className="text-ink-800">{protein}g</strong> / {targets.protein}g</span>
                </div>
                <div className="h-2 rounded-full bg-ink-100 overflow-hidden">
                  <div className="h-full bg-blue-400 rounded-full transition-all" style={{ width: `${proteinPct}%` }} />
                </div>
              </div>
              {(nut && nut.calories > 0) && (
                <div className="mt-2.5">
                  <MacroBar protein={nut.protein_g} carbs={nut.carbs_g} fat={nut.fat_g} />
                </div>
              )}
            </div>
          </div>

          {nut && nut.meals.length > 0 ? (
            <ul className="flex flex-col gap-1 pt-1">
              {nut.meals.map(m => (
                <li key={m.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-ink-400 w-16 shrink-0">{SLOT_LABEL[m.meal_slot]}</span>
                  <span className="text-ink-700 flex-1 truncate">{m.title}</span>
                  {m.calories > 0 && <span className="text-ink-400 shrink-0">{m.calories} kcal</span>}
                </li>
              ))}
            </ul>
          ) : (
            <Link to="/recipes" className="text-xs text-accent-600 hover:text-accent-700 pt-1">
              No meals planned — plan today's meals →
            </Link>
          )}
        </>
      )}
    </div>
  )
}

// ─── Training card ───────────────────────────────────────────────────────────

function TrainingCard({ date }: { date: string }) {
  const { data: blocks = [] } = useTimeBlocks(date)
  const { data: recent = [] } = useHevyWorkouts({ limit: 30 })

  const planned = blocks.filter(b => b.category === 'training')
  const loggedToday = useMemo(
    () => recent.filter(w => w.start_time && formatLocalDate(new Date(w.start_time)) === date),
    [recent, date],
  )

  return (
    <div className="rounded-2xl border border-ink-200 bg-cream-50 p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-ink-800 flex items-center gap-1.5">💪 Training</h3>
        <Link to="/training" className="text-[11px] text-accent-600 hover:text-accent-700 min-h-[28px] px-1.5 flex items-center">
          Open →
        </Link>
      </div>

      {loggedToday.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          {loggedToday.map(w => (
            <div key={w.id} className="flex items-center gap-2 text-sm">
              <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
              <span className="text-ink-800 flex-1 truncate">{w.title || 'Workout'}</span>
              <span className="text-[11px] text-green-600 font-medium shrink-0">Done ✓</span>
            </div>
          ))}
        </div>
      ) : planned.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          {planned.map(b => (
            <div key={b.id} className="flex items-center gap-2 text-sm">
              <span className="w-2 h-2 rounded-full bg-accent-500 shrink-0" />
              <span className="text-ink-800 flex-1 truncate">{b.title}</span>
              {b.start_time && <span className="text-[11px] text-ink-400 shrink-0">{b.start_time.slice(0, 5)}</span>}
            </div>
          ))}
          <p className="text-[11px] text-ink-400 mt-0.5">Planned — not logged yet</p>
        </div>
      ) : (
        <div className="flex flex-col gap-1 py-1">
          <p className="text-sm text-ink-500">Rest day — nothing planned.</p>
          <Link to="/training" className="text-xs text-accent-600 hover:text-accent-700">
            Plan a session →
          </Link>
        </div>
      )}
    </div>
  )
}

// ─── Watch-next card ─────────────────────────────────────────────────────────

function WatchNextCard() {
  const { data: movies = [] } = useMovies()
  const { data: tv = [] } = useTVSeries()

  // Prefer something already in progress; fall back to the wishlist.
  const pick = useMemo(() => {
    const watchingTv    = tv.find(e => e.status === 'watching')
    const watchingMovie = movies.find(e => e.status === 'watching')
    const wishTv        = tv.find(e => e.status === 'wishlist')
    const wishMovie     = movies.find(e => e.status === 'wishlist')
    const chosen = watchingTv ?? watchingMovie ?? wishTv ?? wishMovie
    if (!chosen) return null
    const isTv = 'tv_series' in chosen
    const media = isTv ? chosen.tv_series : chosen.movie
    return {
      title:  media.title,
      poster: media.poster_path,
      kind:   isTv ? 'Series' : 'Movie',
      inProgress: chosen.status === 'watching',
      sub: isTv && chosen.status === 'watching'
        ? `S${chosen.current_season}·E${chosen.current_episode}`
        : null,
    }
  }, [movies, tv])

  return (
    <div className="rounded-2xl border border-ink-200 bg-cream-50 p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-ink-800 flex items-center gap-1.5">🎬 Watch next</h3>
        <Link to="/media" className="text-[11px] text-accent-600 hover:text-accent-700 min-h-[28px] px-1.5 flex items-center">
          Browse →
        </Link>
      </div>

      {pick ? (
        <Link to="/media" className="flex items-center gap-3 group">
          {pick.poster ? (
            <img
              src={posterUrl(pick.poster, 'w154')}
              alt={pick.title}
              className="w-14 h-20 object-cover rounded-lg shrink-0 border border-ink-100"
            />
          ) : (
            <div className="w-14 h-20 rounded-lg bg-cream-200 flex items-center justify-center text-2xl shrink-0">🎬</div>
          )}
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wide text-ink-400">
              {pick.inProgress ? 'Continue' : pick.kind}
            </p>
            <p className="text-sm font-semibold text-ink-800 group-hover:text-accent-700 transition-colors line-clamp-2">
              {pick.title}
            </p>
            {pick.sub && <p className="text-[11px] text-ink-400 mt-0.5">{pick.sub}</p>}
          </div>
        </Link>
      ) : (
        <Link to="/media" className="text-xs text-accent-600 hover:text-accent-700 py-2">
          Nothing on your list — find something →
        </Link>
      )}
    </div>
  )
}

// ─── TodaySummary ────────────────────────────────────────────────────────────

export function TodaySummary({ date }: { date: Date }) {
  const dateStr = formatLocalDate(date)

  return (
    <div className="mb-5">
      <p className="text-[11px] uppercase tracking-wider font-semibold text-ink-400 mb-2">
        {isToday(date) ? 'Today at a glance' : 'At a glance'}
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 max-w-5xl">
        <NutritionCard date={dateStr} />
        <TrainingCard date={dateStr} />
        <WatchNextCard />
      </div>
    </div>
  )
}
