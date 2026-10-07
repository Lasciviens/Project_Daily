import { useState } from 'react'
import { Check, Droplet, Undo2 } from 'lucide-react'
import { todayStr } from '../../../../shared/utils/dateUtils'
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

  const [otherOpen, setOtherOpen] = useState(false)
  const [other, setOther] = useState('')
  const addOther = () => {
    const n = Math.round(Number(other))
    if (!(n > 0 && n <= 3000)) return
    add.mutate(n, { onSuccess: () => { setOther(''); setOtherOpen(false) } })
  }

  // Pace (today only): spread the goal evenly from 07:00 to 22:00.
  let behindBy = 0
  if (date === todayStr() && !reached) {
    const now = new Date()
    const frac = Math.min(Math.max((now.getHours() + now.getMinutes() / 60 - 7) / 15, 0), 1)
    behindBy = Math.round((goal * frac - ml) / 50) * 50
  }

  const chip = 'chip min-h-[44px] px-3 text-meta hover:bg-surface-hover disabled:opacity-40'

  return (
    <div className="@container flex flex-col gap-1.5 py-1">
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
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" onClick={() => add.mutate(250)} disabled={add.isPending} className={chip}>+250 ml</button>
        <button type="button" onClick={() => add.mutate(500)} disabled={add.isPending} className={chip}>+500 ml</button>
        {otherOpen ? (
          <form className="flex items-center gap-1" onSubmit={e => { e.preventDefault(); addOther() }}>
            <input autoFocus value={other} onChange={e => setOther(e.target.value.replace(/\D/g, ''))} inputMode="numeric"
              placeholder="ml" aria-label="Water amount in ml" className="input w-[4.5rem] px-2 text-right tabular-nums"
              onKeyDown={e => { if (e.key === 'Escape') setOtherOpen(false) }} />
            <button type="submit" disabled={add.isPending || !(Number(other) > 0)} className={chip}>Add</button>
          </form>
        ) : (
          <button type="button" onClick={() => setOtherOpen(true)} className={chip}>Other</button>
        )}
        {/* Icon-only while the amount box is open, so the row never wraps on a phone. */}
        <button type="button" onClick={() => undo.mutate()} disabled={undo.isPending || ml <= 0}
          className={`${chip} ml-auto`} aria-label="Undo last water"><Undo2 className="h-3.5 w-3.5" aria-hidden /><span className={otherOpen ? 'hidden @[30rem]:inline' : 'hidden @[20rem]:inline'}>Undo</span></button>
      </div>
      {behindBy >= 250 && (
        <p className="text-meta text-fg-muted tabular-nums">About {behindBy} ml behind pace for this time of day</p>
      )}
    </div>
  )
}
