import { useState } from 'react'
import { ModalShell } from '../../../shared/modals/ModalShell'
import { useEntityModal } from '../../../shared/modals'
import { DateInput } from '../../../shared/components/DateInput'
import { Button } from '../../../shared/ui'
import { todayStr } from '../../../shared/utils/dateUtils'
import { CINEMA_CURRENCIES, type CinemaCurrency, type CinemaVisit } from '../api/cinemaApi'
import { useDeleteCinemaVisit, useSaveCinemaVisit } from '../hooks/useCinemaVisits'

interface Props {
  movieId: string
  title: string
  /** null = a new visit. */
  visit: CinemaVisit | null
  defaultDate: string
  onClose: () => void
}

/** The details of one cinema visit: when, which cinema, where, with whom, cost + currency, note. */
export function CinemaVisitSheet({ movieId, title, visit, defaultDate, onClose }: Props) {
  const save = useSaveCinemaVisit()
  const del = useDeleteCinemaVisit()
  const modal = useEntityModal()
  const [date, setDate] = useState(visit?.watched_on ?? defaultDate)
  const [cinema, setCinema] = useState(visit?.cinema ?? '')
  const [location, setLocation] = useState(visit?.location ?? '')
  const [companions, setCompanions] = useState(visit?.companions ?? '')
  const [cost, setCost] = useState(visit?.cost != null ? String(visit.cost) : '')
  const [currency, setCurrency] = useState<CinemaCurrency>(visit?.currency ?? 'NOK')
  const [note, setNote] = useState(visit?.note ?? '')

  const costNum = cost.trim() === '' ? null : Number(cost.replace(',', '.'))
  const costBad = costNum != null && (!Number.isFinite(costNum) || costNum < 0)
  const busy = save.isPending || del.isPending

  async function onSave() {
    const clean = (s: string) => s.trim() || null
    try {
      await save.mutateAsync({
        id: visit?.id ?? null,
        input: { movie_id: movieId, watched_on: date || null, cinema: clean(cinema), location: clean(location), companions: clean(companions), cost: costNum, currency, note: clean(note) },
      })
      onClose()
    } catch { /* toasted by the hook */ }
  }

  async function onDelete() {
    if (!visit) return
    if (!(await modal.confirm({ title: 'Delete this cinema visit?', confirmLabel: 'Delete', destructive: true }))) return
    try { await del.mutateAsync([visit.id]); onClose() } catch { /* toasted */ }
  }

  return (
    <ModalShell
      onClose={onClose}
      size="sm"
      layer="confirm"
      dismissible={!busy}
      title="Cinema visit"
      subtitle={title}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          {visit ? <Button variant="ghost" className="text-danger" onClick={() => { void onDelete() }} disabled={busy}>Delete</Button> : <span />}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button variant="primary" onClick={() => { void onSave() }} loading={save.isPending} disabled={costBad}>Save</Button>
          </div>
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="field-label">Date</span>
          <DateInput value={date} onChange={setDate} max={todayStr()} aria-label="Date of the visit" className="input" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="field-label">Cinema</span>
          <input className="input" value={cinema} onChange={e => setCinema(e.target.value)} placeholder="e.g. Colosseum Kino" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="field-label">Where</span>
          <input className="input" value={location} onChange={e => setLocation(e.target.value)} placeholder="City or area" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="field-label">With</span>
          <input className="input" value={companions} onChange={e => setCompanions(e.target.value)} placeholder="Who you went with" />
        </label>
        <div className="flex flex-col gap-1 sm:col-span-2">
          <span className="field-label" id="cinema-cost">Cost</span>
          <div className="flex gap-2">
            <input
              aria-labelledby="cinema-cost"
              className="input max-w-[10rem] tabular-nums"
              inputMode="decimal"
              value={cost}
              onChange={e => setCost(e.target.value.replace(/[^0-9.,]/g, ''))}
              placeholder="0"
              aria-invalid={costBad || undefined}
            />
            <select aria-label="Currency" className="input w-auto" value={currency} onChange={e => setCurrency(e.target.value as CinemaCurrency)}>
              {CINEMA_CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className="field-label">Note</span>
          <textarea className="input min-h-[64px] resize-y py-2" rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="Seats, snacks, how it was…" />
        </label>
      </div>
    </ModalShell>
  )
}
