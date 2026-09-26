import { Check, Droplet, Undo2 } from 'lucide-react'
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

  const chip = 'chip min-h-[44px] px-3 text-meta hover:bg-surface-hover disabled:opacity-40'

  return (
    <div className="flex flex-col gap-1.5 py-1">
      <div className="flex items-center justify-between gap-2 text-body">
        <span className="flex items-center gap-1.5 text-fg-muted"><Droplet className="h-3.5 w-3.5" aria-hidden /> Water</span>
        <span className="flex items-center gap-1 tabular-nums">
          {reached && <Check data-tone="success" className="tone-text h-3.5 w-3.5" aria-label="Goal reached" />}
          <strong className="text-fg">{litres(ml)}</strong>
          <span className="text-fg-muted">/ {litres(goal)} L</span>
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full bg-info transition-all" style={{ width: `${pct}%` }} />
      </div>
      <div className="flex items-center gap-1.5">
        <button type="button" onClick={() => add.mutate(250)} disabled={add.isPending} className={chip}>+250 ml</button>
        <button type="button" onClick={() => add.mutate(500)} disabled={add.isPending} className={chip}>+500 ml</button>
        <button type="button" onClick={() => undo.mutate()} disabled={undo.isPending || ml <= 0}
          className={`${chip} ml-auto`} aria-label="Undo last water"><Undo2 className="h-3.5 w-3.5" aria-hidden /> Undo</button>
      </div>
    </div>
  )
}
