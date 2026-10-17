import { useId, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { ModalShell } from '../../../shared/modals/ModalShell'
import { Button, MetaLine } from '../../../shared/ui'
import { DateInput } from '../../../shared/components/DateInput'
import { ChipSelect, RecurrenceField } from '../../../shared/components/plan-modal/fields'
import { AddFact, FactRow } from '../../../shared/components/plan-modal/ItemFacts'
import { chipClass } from '../../../shared/components/plan-modal/fieldStyles'
import { RECURRING_EDIT_OPTIONS } from '../../../shared/components/plan-modal/planModal.config'
import { usePushNotifications } from '../../../shared/hooks/usePushNotifications'
import { todayStr } from '../../../shared/utils/dateUtils'
import { useIngredientLibrary } from '../../recipes/hooks/useIngredientLibrary'
import { useRecipes } from '../../recipes/hooks/useRecipes'
import {
  useDeleteSupplementSchedule, useDoseHistory, useSaveSupplementSchedule, useSupplementStock,
} from '../hooks/useSupplements'
import {
  CUSTOM_UNITS, REMIND_EVERY, daysBetween, newScheduleForm, nextTime, scheduleProblem, scheduleRowFromForm, scheduleToForm,
  type EndsMode, type ScheduleForm,
} from '../scheduleForm'
import { doseLabel, formatAmount, isPaused, resumePause, type RemindMode, type SupplementSchedule } from '../supplementDoses'
import { WhatField } from './WhatField'
import { plural, portionWord } from '../../recipes/foodAmount'
import { TimeChip } from './TimeChip'

const REMIND_OPTIONS: { value: RemindMode; label: string }[] = [
  { value: 'until_taken', label: 'Until taken' },
  { value: 'once', label: 'Once' },
  { value: 'off', label: 'No reminder' },
]
const ENDS_OPTIONS: { value: EndsMode; label: string }[] = [
  { value: 'never', label: 'Never' },
  { value: 'date', label: 'On a date' },
  { value: 'days', label: 'After N days' },
]
const everyLabel = (m: number) => (m < 60 ? `${m} min` : m % 60 === 0 ? `${m / 60} h` : `${Math.floor(m / 60)} h ${m % 60} min`)
const unitLabel = (u: string) => (u === 'serving' ? 'portion' : u)

/**
 * The supplement schedule popup (migration 160): what, the dose, the times,
 * the repeat (the planner's own field, so it repeats every way a plan does),
 * start / end, reminders, and the optional notes, stock and pause.
 *   Kreatin                                                 ×
 *   Dose [5] [g ▾] (= 1 scoop)    Times [08:00 ×] [+ time]
 *   Repeat [Every day ▾]   Starts 16.10.2026   Ends [Never ▾]
 *   Remind [Until taken ▾] every [1 h ▾] until [22:00]
 *   + Notes  + Stock  + Pause
 *   Last 28 days: 26 taken · 1 skipped · 1 missed
 */
export function SupplementScheduleSheet({ schedule, title, onClose }: {
  /** The saved schedule, or null for a new one. */
  schedule: SupplementSchedule | null
  /** A new one's name. */
  title?: string
  onClose: () => void
}) {
  const today = todayStr()
  const [form, setForm] = useState<ScheduleForm>(() => (schedule ? scheduleToForm(schedule) : newScheduleForm(today, title)))
  const set = (p: Partial<ScheduleForm>) => setForm(f => ({ ...f, ...p }))
  const [tried, setTried] = useState(false)
  const [valuesOpen, setValuesOpen] = useState(() => !!schedule && (schedule.calories > 0 || schedule.protein_g > 0))
  const ids = { amount: useId(), notes: useId(), stock: useId() }

  const { data: foods = [] } = useIngredientLibrary()
  const { data: recipes = [] } = useRecipes()
  const save = useSaveSupplementSchedule()
  const del = useDeleteSupplementSchedule()
  const history = useDoseHistory(schedule)
  const stock = useSupplementStock(schedule ? [schedule] : []).get(schedule?.id ?? '')
  const push = usePushNotifications()

  const food = form.source.kind === 'food' ? foods.find(f => f.id === (form.source as { id: string }).id) : undefined
  const recipe = form.source.kind === 'recipe' ? recipes.find(r => r.id === (form.source as { id: string }).id) : undefined
  // A recipe's dose counts its own portion word (157), like the diary.
  const portion = recipe?.serving_label ?? null
  const problem = scheduleProblem(form)
  const amount = Number(form.amount.replace(',', '.'))
  const units = form.source.kind === 'food' ? (food?.unit === 'ml' ? ['ml', 'g'] : ['g', 'ml']) : form.source.kind === 'recipe' ? ['serving'] : CUSTOM_UNITS
  const servingHint = food?.serving_grams && Number.isFinite(amount) && amount > 0 && food.serving_label
    ? (amount === food.serving_grams ? `= ${food.serving_label}` : `= ${formatAmount(amount / food.serving_grams)} × ${food.serving_label}`)
    : null
  const saving = save.isPending
  // A pause still on (or ahead); an ended one is history and the row waits as "+ Pause".
  const pauseOn = isPaused({ paused_from: form.pausedFrom, paused_until: form.pausedUntil }, today)

  async function onSave() {
    setTried(true)
    if (problem) return
    try {
      await save.mutateAsync({ input: scheduleRowFromForm(form), id: schedule?.id })
      onClose()
    } catch { /* the hook reported it */ }
  }

  async function onDelete() {
    if (!schedule) return
    const r = await del.run([schedule.id], {
      title: `Delete the ${schedule.title} schedule?`, message: 'Doses already taken stay in the diary.', done: `${schedule.title} schedule deleted`,
    })
    if (r === 'deleted' || r === 'gone') onClose()
  }

  const footer = (
    <div className="flex items-center gap-1.5">
      {schedule && (
        <Button variant="ghost" size="sm" icon={<Trash2 />} onClick={() => { void onDelete() }} disabled={saving}
          aria-label="Delete" className="-ml-2 shrink-0 text-danger hover:text-danger max-sm:px-2.5">
          <span className="max-sm:sr-only">Delete</span>
        </Button>
      )}
      <Button variant="ghost" size="sm" onClick={onClose} disabled={saving} className="ml-auto">Cancel</Button>
      <Button variant="primary" size="sm" onClick={() => { void onSave() }} loading={saving} className="min-w-[5.5rem]">
        {saving ? 'Saving…' : schedule ? 'Save' : 'Schedule'}
      </Button>
    </div>
  )

  return (
    <ModalShell onClose={onClose} title={schedule ? 'Supplement schedule' : 'Schedule a supplement'} footer={footer} size="md" compact dismissible={!saving}>
      <div className="flex flex-col gap-2.5">
        <WhatField
          title={form.title} source={form.source} foods={foods} recipes={recipes}
          onChange={p => setForm(f => {
            const next: ScheduleForm = { ...f, ...(p.title != null ? { title: p.title } : {}), ...(p.source ? { source: p.source } : {}) }
            if (p.food) return { ...next, unit: p.food.unit === 'ml' ? 'ml' : 'g', amount: p.food.serving_grams ? String(p.food.serving_grams) : f.amount }
            if (p.recipe) return { ...next, unit: 'serving', amount: '1' }
            if (p.source?.kind === 'custom') return { ...next, unit: CUSTOM_UNITS.includes(f.unit) ? f.unit : 'g' }
            return next
          })}
        />

        <FactRow label="Dose" htmlFor={ids.amount}>
          <div className="flex flex-wrap items-center gap-1.5">
            <input id={ids.amount} type="text" inputMode="decimal" value={form.amount} onChange={e => set({ amount: e.target.value })}
              className="input input-sm w-16 text-center tabular-nums" aria-label="Dose amount" />
            {units.length > 1
              ? <ChipSelect label="Dose unit" value={form.unit} options={units.map(u => ({ value: u, label: unitLabel(u) }))} onChange={u => set({ unit: u })} />
              : <span className="text-body text-fg-2">{plural(portionWord(portion), amount)}</span>}
            {servingHint && <span className="text-meta text-fg-muted">{servingHint}</span>}
            {food?.serving_grams && food.serving_label && amount !== food.serving_grams && (
              <button type="button" onClick={() => set({ amount: String(food.serving_grams) })} className={chipClass('quiet')}>
                {food.serving_label} · {formatAmount(food.serving_grams)} g
              </button>
            )}
          </div>
        </FactRow>

        <FactRow label="Times">
          <div className="flex flex-wrap items-center gap-1.5">
            {form.times.map((t, i) => (
              <TimeChip key={`${t}-${i}`} label="Dose time" value={t}
                onChange={v => set({ times: [...new Set(form.times.map((x, j) => (j === i ? v : x)))].sort() })}
                onRemove={form.times.length > 1 ? () => set({ times: form.times.filter((_, j) => j !== i) }) : undefined} />
            ))}
            {form.times.length < 12 && (
              <button type="button" onClick={() => set({ times: [...form.times, nextTime(form.times)].sort() })} className={chipClass('add')}>
                <Plus aria-hidden />time
              </button>
            )}
          </div>
        </FactRow>

        <FactRow label="Repeat">
          <RecurrenceField value={form.repeat} onChange={p => set({ repeat: { ...form.repeat, ...p } })} start={form.start} options={RECURRING_EDIT_OPTIONS} />
        </FactRow>

        <FactRow label="Starts">
          <DateInput value={form.start} onChange={v => set({ start: v })} aria-label="First day" className="input input-sm w-[8.5rem] tabular-nums" />
        </FactRow>

        <FactRow label="Ends">
          <div className="flex flex-wrap items-center gap-1.5">
            <ChipSelect label="Ends" value={form.ends} options={ENDS_OPTIONS} onChange={e => set({
              ends: e,
              ...(e === 'days' && form.endDate && form.endDate >= form.start ? { endDays: String(daysBetween(form.start, form.endDate)) } : {}),
            })} />
            {form.ends === 'date' && (
              <DateInput value={form.endDate} onChange={v => set({ endDate: v })} min={form.start} aria-label="Last day" className="input input-sm w-[8.5rem] tabular-nums" />
            )}
            {form.ends === 'days' && (
              <span className="flex items-center gap-1.5 text-body text-fg-2">
                <input type="text" inputMode="numeric" value={form.endDays} onChange={e => set({ endDays: e.target.value })}
                  aria-label="Number of days" className="input input-sm w-14 text-center tabular-nums" />
                days
              </span>
            )}
          </div>
        </FactRow>

        <FactRow label="Remind">
          <div className="flex flex-wrap items-center gap-1.5 text-body text-fg-2">
            <ChipSelect label="Reminders" value={form.remind} options={REMIND_OPTIONS} onChange={r => set({ remind: r })} />
            {form.remind === 'until_taken' && (
              <>
                <span>every</span>
                <ChipSelect label="Remind every" value={String(form.every)} options={REMIND_EVERY.map(m => ({ value: String(m), label: everyLabel(m) }))}
                  onChange={m => set({ every: Number(m) })} />
                <span>until</span>
                <TimeChip label="Remind until" value={form.until} onChange={v => set({ until: v })} />
              </>
            )}
            {form.remind === 'once' && <span className="text-meta text-fg-muted">at the dose's time</span>}
          </div>
        </FactRow>
        {form.remind !== 'off' && (!push.supported || !push.enabled) && (
          <p className="text-meta text-fg-muted">
            {push.supported
              ? 'Reminders arrive as notifications once they are on for this device: menu → Turn on notifications.'
              : 'This browser shows no reminders — they reach the app installed on the iPhone home screen, with notifications on.'}
          </p>
        )}

        {form.source.kind === 'custom' && valuesOpen && (
          <FactRow label="Values">
            <div className="grid max-w-xs grid-cols-4 gap-1.5">
              {([['kcal', 'calories'], ['Protein', 'protein'], ['Carbs', 'carbs'], ['Fat', 'fat']] as const).map(([label, key]) => (
                <label key={key} className="flex flex-col gap-0.5">
                  <span className="text-micro text-fg-muted">{label}</span>
                  <input type="text" inputMode="decimal" value={form[key]} onChange={e => set({ [key]: e.target.value })}
                    placeholder="0" className="input input-sm w-full text-center tabular-nums" />
                </label>
              ))}
            </div>
          </FactRow>
        )}

        {form.notes != null && (
          <FactRow label="Notes" htmlFor={ids.notes}>
            <textarea id={ids.notes} value={form.notes} onChange={e => set({ notes: e.target.value })} rows={2}
              className="input input-sm h-auto min-h-[3.5rem] w-full max-w-md py-1.5" placeholder="With water, after food…" />
          </FactRow>
        )}

        {form.stock != null && (
          <FactRow label="Stock" htmlFor={ids.stock}>
            <div className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-1.5 text-body text-fg-2">
                <input id={ids.stock} type="text" inputMode="decimal" value={form.stock} onChange={e => set({ stock: e.target.value })}
                  className="input input-sm w-20 text-center tabular-nums" aria-label="How much is in stock" />
                <span>{form.source.kind === 'recipe' ? plural(portionWord(portion), 2) : form.unit} · warn</span>
                <input type="text" inputMode="numeric" value={form.refillDays} onChange={e => set({ refillDays: e.target.value })}
                  className="input input-sm w-12 text-center tabular-nums" aria-label="Warn this many days before it runs out" />
                <span>days ahead</span>
                <button type="button" onClick={() => set({ stock: null })} className={chipClass('remove')}>No stock</button>
              </div>
              <MetaLine className="text-meta tabular-nums text-fg-muted" items={[
                Number(form.stock) > 0 && amount > 0 && `≈ ${Math.floor(Number(form.stock) / amount)} doses`,
                schedule?.stock_amount != null && Number(form.stock) === schedule.stock_amount && stock &&
                  `${formatAmount(stock.left)} left now${stock.days != null ? ` · ≈ ${stock.days} days` : ''}`,
              ]} />
            </div>
          </FactRow>
        )}

        {pauseOn && (
          <FactRow label="Paused">
            <div className="flex flex-wrap items-center gap-1.5 text-body text-fg-2">
              <span>from</span>
              <DateInput value={form.pausedFrom ?? ''} onChange={v => set({ pausedFrom: v || today })} aria-label="Paused from" className="input input-sm w-[8.5rem] tabular-nums" />
              <span>until</span>
              <DateInput value={form.pausedUntil ?? ''} onChange={v => set({ pausedUntil: v || null })} min={form.pausedFrom ?? undefined}
                placeholder="you resume" aria-label="Paused until" className="input input-sm w-[8.5rem] tabular-nums" />
              <button type="button" onClick={() => { const r = resumePause({ paused_from: form.pausedFrom }, today); set({ pausedFrom: r.from, pausedUntil: r.until }) }}
                className={chipClass('remove')}>Resume</button>
            </div>
          </FactRow>
        )}

        <div className="flex flex-wrap items-center gap-x-1">
          {form.source.kind === 'custom' && !valuesOpen && <AddFact label="Calories" onClick={() => setValuesOpen(true)} />}
          {form.notes == null && <AddFact label="Notes" onClick={() => set({ notes: '' })} />}
          {form.stock == null && <AddFact label="Stock" onClick={() => set({ stock: '' })} />}
          {!pauseOn && <AddFact label="Pause" onClick={() => set({ pausedFrom: today, pausedUntil: null })} />}
        </div>

        {history && (
          <MetaLine className="text-meta tabular-nums text-fg-muted" items={[
            <span key="l" className="font-medium text-fg-2">Last 28 days</span>,
            `${history.taken} taken`, `${history.skipped} skipped`, `${history.missed} missed`,
          ]} />
        )}
        {!problem && amount > 0 && (
          <p className="text-meta text-fg-muted">
            Each dose logs <span className="text-fg-2">{form.title.trim() || 'it'} {doseLabel(amount, form.source.kind === 'recipe' ? 'serving' : form.unit, portion)}</span> in the Supplement slot.
          </p>
        )}
        {tried && problem && <p role="alert" className="text-meta text-danger">{problem}</p>}
      </div>
    </ModalShell>
  )
}
