import { useMemo } from 'react'
import { useQueries, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { useRowsDelete } from '../../../shared/hooks/useRowsDelete'
import { qk, STALE } from '../../../shared/query'
import { putRowsInCache } from '../../../shared/query/cachePatch'
import { toast } from '../../../app/store'
import { shiftDateStr, todayStr } from '../../../shared/utils/dateUtils'
import { useNow } from '../../home/hooks/useNow'
import {
  countTakenSince, fetchDoseFacts, fetchSupplementSchedule, fetchSupplementSchedules, removeTakenLines, saveSupplementSchedule,
  setDoseState, setSupplementPause, takeDose, type DoseRef, type SupplementScheduleInput,
} from '../api/supplementsApi'
import {
  doseHistory, dosesOn, hhmm, isPaused, localNow, stockLeft, takenAtFor,
  type Dose, type DoseFacts, type DoseHistory, type DoseState, type LocalNow, type StockLeft, type SupplementSchedule, type TakenDose,
} from '../supplementDoses'

const EMPTY_FACTS: DoseFacts = { taken: [], states: [] }

export function useSupplementSchedules() {
  return useQuery({
    queryKey: qk.supplements.schedules(),
    queryFn: fetchSupplementSchedules,
    staleTime: STALE.default,
  })
}

/** One schedule by id (the popup loads its own row, never a list's copy). */
export function useSupplementSchedule(id: string | null | undefined) {
  return useQuery({
    queryKey: qk.supplements.schedule(id ?? ''),
    queryFn: () => fetchSupplementSchedule(id!),
    enabled: !!id,
    staleTime: STALE.short,
  })
}

/** Taken doses and dose states from `from` to `to`. */
export function useDoseFacts(from: string, to: string, enabled = true) {
  return useQuery({
    queryKey: qk.supplements.facts(from, to),
    queryFn: () => fetchDoseFacts(from, to),
    enabled,
    staleTime: STALE.live,
  })
}

/** The home clock, read again every minute while `live` ("due 2 h ago" moves on). */
export function useLocalNow(live = true): LocalNow {
  return localNow(useNow(live, 60_000))
}

/** One day's doses with their states (supplementDoses.dosesOn), and the schedules. */
export function useSupplementDoses(date: string) {
  const schedules = useSupplementSchedules()
  const facts = useDoseFacts(date, date, (schedules.data?.length ?? 0) > 0)
  const now = useLocalNow(date === todayStr())
  const doses = useMemo(
    () => dosesOn(schedules.data ?? [], date, facts.data ?? EMPTY_FACTS, now),
    [schedules.data, facts.data, date, now],
  )
  return {
    doses, schedules: schedules.data ?? [], now,
    isLoading: schedules.isLoading || facts.isLoading,
    isError: schedules.isError || facts.isError,
    refetch: () => Promise.all([schedules.refetch(), facts.refetch()]),
  }
}

/** "Last 28 days: 26 taken · 1 skipped · 1 missed" for one schedule. */
export function useDoseHistory(schedule: SupplementSchedule | null | undefined): DoseHistory | null {
  const today = todayStr()
  const facts = useDoseFacts(shiftDateStr(today, -27), today, !!schedule)
  const now = useLocalNow(false)
  return useMemo(
    () => (schedule && facts.data ? doseHistory(schedule, facts.data, now) : null),
    [schedule, facts.data, now],
  )
}

/** What is left of each counted stock (only schedules that keep one). */
export function useSupplementStock(schedules: readonly SupplementSchedule[]): Map<string, StockLeft> {
  const counted = schedules.filter(s => s.stock_amount != null && s.stock_set_at)
  const results = useQueries({
    queries: counted.map(s => ({
      queryKey: qk.supplements.stock(s.id, s.stock_set_at!),
      queryFn: () => countTakenSince(s.id, s.stock_set_at!),
      staleTime: STALE.default,
    })),
  })
  const today = todayStr()
  const out = new Map<string, StockLeft>()
  counted.forEach((s, i) => {
    const n = results[i]?.data
    const left = n == null ? null : stockLeft(s, n, today)
    if (left) out.set(s.id, left)
  })
  return out
}

// ── Writes ──────────────────────────────────────────────────────────────────
// Each write's own answer goes into the cache at once (the card turns as the
// write answers); the background refresh follows (THEME §10).

/** Puts a change into every cached range of taken doses / states holding `date`. */
function patchFacts(qc: QueryClient, date: string, fn: (f: DoseFacts) => DoseFacts) {
  for (const [key, data] of qc.getQueriesData<DoseFacts>({ queryKey: [...qk.supplements.all, 'facts'] })) {
    const [, , from, to] = key as readonly unknown[]
    if (data && typeof from === 'string' && typeof to === 'string' && from <= date && date <= to) qc.setQueryData(key, fn(data))
  }
}

const refOf = (d: Pick<Dose, 'scheduleId' | 'date' | 'time'>): DoseRef => ({ scheduleId: d.scheduleId, date: d.date, time: d.time })
const sameDose = (s: DoseState, d: DoseRef) => s.schedule_id === d.scheduleId && s.dose_date === d.date && hhmm(s.dose_time) === hhmm(d.time)
const named = (doses: readonly Pick<Dose, 'title' | 'label'>[]) =>
  doses.length === 1 ? `${doses[0].title} ${doses[0].label}` : `${doses.length} supplements`

/** The facts with one dose's state changed (a new state row when it had none). */
function withState(f: DoseFacts, d: DoseRef, patch: Partial<DoseState>): DoseFacts {
  const states = f.states.some(s => sameDose(s, d))
    ? f.states.map(s => (sameDose(s, d) ? { ...s, ...patch } : s))
    : [...f.states, { schedule_id: d.scheduleId, dose_date: d.date, dose_time: d.time, skipped_at: null, snoozed_until: null, last_reminded_at: null, reminders_sent: 0, ...patch }]
  return { ...f, states }
}

export function useSaveSupplementSchedule() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action: 'save_supplement_schedule',
    successMessage: (row: SupplementSchedule, v: { input: SupplementScheduleInput; id?: string }) =>
      v.id ? `${row.title} saved` : `${row.title} scheduled`,
    mutationFn: ({ input, id }: { input: SupplementScheduleInput; id?: string }) => saveSupplementSchedule(input, id),
    onSuccess: row => putRowsInCache(qc, qk.supplements.all, [row]),
    invalidates: [qk.supplements.all],
  })
}

/** THE schedule delete: asks, deletes (its dose states go with it; its taken
 *  lines stay in the diary), "Kreatin schedule deleted · Undo". */
export function useDeleteSupplementSchedule() {
  return useRowsDelete({
    table: 'supplement_schedules', action: 'delete_supplement_schedule', invalidates: ['nutrition'], cache: qk.supplements.all,
  })
}

export function usePauseSupplement() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action: 'pause_supplement_schedule',
    successMessage: (row: SupplementSchedule) => (isPaused(row, todayStr()) ? `${row.title} paused` : `${row.title} resumed`),
    mutationFn: ({ id, from, until }: { id: string; from: string | null; until: string | null }) => setSupplementPause(id, from, until),
    onSuccess: row => putRowsInCache(qc, qk.supplements.all, [row]),
    invalidates: [qk.supplements.all],
  })
}

/** Undo of a Take: the lines it wrote go again. */
function useUndoTake() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action: 'undo_take_supplement',
    successMessage: (_: void, lines: readonly TakenDose[]) => (lines.length === 1 ? 'Not taken' : `${lines.length} doses not taken`),
    mutationFn: (lines: readonly TakenDose[]) => removeTakenLines(lines.map(l => l.id)),
    onSuccess: (_: void, lines: readonly TakenDose[]) => {
      const gone = new Set(lines.map(l => l.id))
      for (const date of new Set(lines.map(l => l.date))) patchFacts(qc, date, f => ({ ...f, taken: f.taken.filter(t => !gone.has(t.id)) }))
    },
    invalidates: ['nutrition'],
  })
}

/** Take one dose or several (decision 11: each writes its diary line) —
 *  "Kreatin 5 g taken · Undo". `at`: 'HH:MM' it was taken at on the dose's
 *  day; without it today's dose is taken now, another day's at its own time. */
export function useTakeDoses() {
  const qc = useQueryClient()
  const undo = useUndoTake()
  return useMutationWithFeedback({
    action: 'take_supplement',
    silent: 'the Take reports with its own Undo toast',
    mutationFn: async ({ doses, at }: { doses: readonly Dose[]; at?: string }) => {
      const lines: { line: TakenDose; fresh: boolean }[] = []
      const today = todayStr()
      for (const d of doses) {
        const takenAt = takenAtFor(d, at, today)
        const r = await takeDose(refOf(d), takenAt)
        lines.push({
          fresh: !r.already,
          line: { id: r.entryId, supplement_schedule_id: d.scheduleId, date: d.date, dose_time: d.time, created_at: takenAt ?? new Date().toISOString() },
        })
      }
      return lines
    },
    onSuccess: (lines, { doses }) => {
      for (const { line } of lines) {
        patchFacts(qc, line.date, f => (f.taken.some(t => t.id === line.id) ? f : { ...f, taken: [...f.taken, line] }))
      }
      const fresh = lines.filter(l => l.fresh).map(l => l.line)
      const msg = `${named(doses)} taken`
      if (fresh.length) toast.undo(msg, () => undo.mutate(fresh))
      else toast.success(msg)
    },
    invalidates: ['nutrition'],
  })
}

/** Takes a skip back (the ⋯ menu's "Not skipped", a Skip's Undo). */
export function useUnskipDose() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action: 'unskip_supplement',
    successMessage: (_: void, d: Dose) => `${d.title} not skipped`,
    mutationFn: (d: Dose) => setDoseState(refOf(d), { skipped_at: null }),
    onSuccess: (_: void, d: Dose) => patchFacts(qc, d.date, f => withState(f, refOf(d), { skipped_at: null })),
    invalidates: [qk.supplements.all],
  })
}

/** Skip a dose — "Kreatin skipped · Undo". */
export function useSkipDose() {
  const qc = useQueryClient()
  const unskip = useUnskipDose()
  return useMutationWithFeedback({
    action: 'skip_supplement',
    silent: 'the Skip reports with its own Undo toast',
    mutationFn: async (d: Dose) => {
      const at = new Date().toISOString()
      await setDoseState(refOf(d), { skipped_at: at })
      return at
    },
    onSuccess: (at, d) => {
      patchFacts(qc, d.date, f => withState(f, refOf(d), { skipped_at: at }))
      toast.undo(`${d.title} skipped`, () => unskip.mutate(d))
    },
    invalidates: [qk.supplements.all],
  })
}

/** Snooze: no reminder for `minutes` (an hour by default), then one again. */
export function useSnoozeDose() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action: 'snooze_supplement',
    successMessage: (until: string, v: { dose: Dose }) => {
      const t = new Date(until)
      return `${v.dose.title}: reminder again at ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`
    },
    mutationFn: async ({ dose, minutes = 60 }: { dose: Dose; minutes?: number }) => {
      const until = new Date(Date.now() + minutes * 60_000).toISOString()
      await setDoseState(refOf(dose), { snoozed_until: until })
      return until
    },
    onSuccess: (until, { dose }) => patchFacts(qc, dose.date, f => withState(f, refOf(dose), { snoozed_until: until })),
    invalidates: [qk.supplements.all],
  })
}
