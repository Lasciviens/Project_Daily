import { useWaterDay, useAddWater, useUndoWater } from '../../hooks/useWater'
import { useDayTargets } from '../../hooks/useDayTargets'

// Water tracker — daily ml total vs a goal (default 2 L). Quick +250/+500 ml
// taps + undo-last. Logs to water_log_entries (own table, never in the calorie
// ring). Shared by the Daily NutritionCard and Food · Today, so a tap on one
// updates the other (same ['water', date] query key).

// Whole litres show with no decimals (2 L), partials with two (1.25 L).
function litres(ml: number): string {
  return (ml / 1000).toFixed(ml % 1000 === 0 ? 0 : 2)
}

export function WaterTracker({ date }: { date: string }) {
  const { data: ml = 0 } = useWaterDay(date)
  const { targets } = useDayTargets()
  const add  = useAddWater(date)
  const undo = useUndoWater(date)

  const goal = targets.water > 0 ? targets.water : 2000
  const pct = Math.min(Math.round((ml / goal) * 100), 100)
  const reached = ml >= goal

  const chip = 'min-h-[36px] px-2.5 rounded-full border border-ink-200 text-ink-600 hover:border-accent-300 hover:text-accent-600 text-[11px] font-medium transition-colors disabled:opacity-40'

  return (
    <div className="flex flex-col gap-1.5 py-1">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-ink-500">💧 Water</span>
        <span className="tabular-nums">
          {reached && <span className="text-sky-600 font-medium">✓ </span>}
          <strong className="text-ink-800">{litres(ml)}</strong>
          <span className="text-ink-400"> / {litres(goal)} L</span>
        </span>
      </div>
      <div className="h-2 rounded-full bg-ink-100 overflow-hidden">
        <div className="h-full bg-sky-400 rounded-full transition-all" style={{ width: `${pct}%` }} />
      </div>
      <div className="flex items-center gap-1.5">
        <button onClick={() => add.mutate(250)} disabled={add.isPending} className={chip}>+250 ml</button>
        <button onClick={() => add.mutate(500)} disabled={add.isPending} className={chip}>+500 ml</button>
        <button onClick={() => undo.mutate()} disabled={undo.isPending || ml <= 0}
          className={`${chip} ml-auto`} title="Undo last" aria-label="Undo last water">↶ undo</button>
      </div>
    </div>
  )
}
