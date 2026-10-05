import { useMemo, useState } from 'react'
import { BookOpen, Trash2 } from 'lucide-react'
import { ModalShell } from '../../../shared/modals/ModalShell'
import { useEntityModal } from '../../../shared/modals'
import { Button, IconButton } from '../../../shared/ui'
import { STAGE_TONE } from '../../../shared/theme/stage'
import { DateInput } from '../../../shared/components/DateInput'
import { formatDate, formatDateTime } from '../../../shared/utils/dateFormat'
import { StarRating } from '../../media/components/StarRating'
import { READ_STATUS_LABEL, READ_STATUSES } from '../bookTones'
import { statusPatch, useBookEvents, useDeleteBook, useUpdateBook } from '../hooks/useLibrary'
import { useAiNotes, useDeleteAiNote } from '../hooks/useKoboControl'
import { formatDuration, sessions } from '../readingAggregate'
import type { Book, BookPatch, ReadStatus } from '../types'
import { BookCoverEditor } from './BookCoverEditor'
import { BookDetailsFields } from './BookDetailsFields'
import { detailsDraft, detailsPatch, detailsProblem, type DetailsDraft } from './bookDetails'
import { AskedList } from './kobo/AskedCard'

const STATUS_STAGE = { want: 'planned', reading: 'active', finished: 'done', paused: 'paused', dropped: 'dropped' } as const

interface Draft extends DetailsDraft {
  title: string; author: string; series: string; read_status: ReadStatus; rating: number | null
  review: string; notes: string; started: string; finished: string
}
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : '')
const draftOf = (b: Book): Draft => ({
  ...detailsDraft(b),
  title: b.title, author: b.author ?? '', series: b.series ?? '', read_status: b.read_status, rating: b.rating,
  review: b.review ?? '', notes: b.notes ?? '', started: day(b.started_at), finished: day(b.finished_at),
})
/** A date field stored at local noon, so no time zone moves it to another day. */
const noon = (d: string) => (d ? new Date(`${d}T12:00:00`).toISOString() : null)

// Seeded once (the request keeps the first loaded row), so a background
// refetch never overwrites what is being typed.
export function BookSheet({ book, onClose }: { book: Book; onClose: () => void }) {
  const [d, setD] = useState<Draft>(() => draftOf(book))
  const update = useUpdateBook()
  const remove = useDeleteBook()
  const notes = useAiNotes(book.id)
  const removeNote = useDeleteAiNote()
  const modal = useEntityModal()
  const events = useBookEvents(book.id)
  const recent = useMemo(() => sessions(events.data ?? []).slice(-8).reverse(), [events.data])
  const total = useMemo(() => (events.data ?? []).reduce((t, e) => t + e.duration_seconds, 0), [events.data])
  const set = (p: Partial<Draft>) => setD(x => ({ ...x, ...p }))
  const problem = detailsProblem(d)

  function pickStatus(s: ReadStatus) {
    const stamps = statusPatch({ ...book, started_at: noon(d.started), finished_at: noon(d.finished) }, s)
    set({ read_status: s, started: stamps.started_at ? day(stamps.started_at) : d.started, finished: stamps.finished_at ? day(stamps.finished_at) : d.finished })
  }

  function save() {
    const title = d.title.trim()
    if (!title || problem) return
    const patch: BookPatch = {
      ...detailsPatch(d, detailsDraft(book)),
      title, author: d.author.trim() || null, series: d.series.trim() || null, read_status: d.read_status,
      rating: d.rating, review: d.review.trim() || null, notes: d.notes.trim() || null,
      started_at: d.started ? (d.started === day(book.started_at) ? book.started_at : noon(d.started)) : null,
      finished_at: d.finished ? (d.finished === day(book.finished_at) ? book.finished_at : noon(d.finished)) : null,
    }
    update.mutate({ id: book.id, patch }, { onSuccess: onClose })
  }

  async function del() {
    const ok = await modal.confirm({
      title: `Delete “${book.title}”?`,
      message: book.on_device ? 'Its reading history goes too. The file stays on the Kobo, so the next sync adds the book back.' : 'Its reading history goes too.',
      confirmLabel: 'Delete', destructive: true,
    })
    if (ok) remove.mutate(book.id, { onSuccess: onClose })
  }

  return (
    <ModalShell onClose={onClose} title="Book" size="lg" dismissible={!update.isPending}
      footer={
        <div className="flex items-center gap-2">
          <IconButton label="Delete book" onClick={() => { void del() }} className="text-danger"><Trash2 /></IconButton>
          <Button className="ml-auto" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} loading={update.isPending} disabled={!d.title.trim() || !!problem}>Save</Button>
        </div>
      }>
      <div className="grid gap-5 md:grid-cols-[11rem_minmax(0,1fr)]">
        <div className="flex flex-col gap-3">
          <BookCoverEditor book={book} />
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-meta">
            <Fact label="Progress" value={book.progress_pct != null ? `${Math.round(book.progress_pct)}%` : null} />
            <Fact label="Time read" value={book.read_seconds ? formatDuration(book.read_seconds) : total ? formatDuration(total) : null} />
            <Fact label="Pages" value={book.page_count ? String(book.page_count) : null} />
            <Fact label="Last read" value={book.last_read_at ? formatDate(book.last_read_at) : null} />
            <Fact label="Language" value={book.language} />
            <Fact label="Publisher" value={[book.publisher, book.published_year].filter(Boolean).join(', ') || null} />
            <Fact label="ISBN" value={book.isbn} />
            <Fact label="On the Kobo" value={book.on_device ? 'Yes' : 'No'} />
          </dl>
          {/* News issues live under Library → News; a book filed there by mistake comes back with one tap. */}
          <Button size="sm" disabled={update.isPending}
            onClick={() => update.mutate({ id: book.id, patch: { kind: book.kind === 'news' ? 'book' : 'news' } })}>
            {book.kind === 'news' ? 'This is a book, not news' : 'This is a news issue'}
          </Button>
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <label className="flex flex-col gap-1"><span className="field-label">Title</span>
            <input className="input min-h-[44px]" value={d.title} onChange={e => set({ title: e.target.value })} /></label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1"><span className="field-label">Author</span>
              <input className="input min-h-[44px]" value={d.author} onChange={e => set({ author: e.target.value })} /></label>
            <label className="flex flex-col gap-1"><span className="field-label">Series</span>
              <input className="input min-h-[44px]" value={d.series} onChange={e => set({ series: e.target.value })} /></label>
          </div>
          <div>
            <span className="field-label">Status</span>
            <div role="group" aria-label="Status" className="grid grid-cols-2 gap-1 sm:grid-cols-3">
              {READ_STATUSES.map(s => (
                <button key={s} type="button" aria-pressed={d.read_status === s} data-tone={STAGE_TONE[STATUS_STAGE[s]]}
                  onClick={() => pickStatus(s)} className="stage-option press-feedback">
                  <span aria-hidden className="tone-dot" />
                  <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{READ_STATUS_LABEL[s]}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1"><span className="field-label">Started</span>
              <DateInput value={d.started} onChange={v => set({ started: v })} aria-label="Started" /></label>
            <label className="flex flex-col gap-1"><span className="field-label">Finished</span>
              <DateInput value={d.finished} onChange={v => set({ finished: v })} aria-label="Finished" /></label>
          </div>
          <BookDetailsFields draft={d} onChange={set} problem={problem} />
          <div><span className="field-label">Your rating</span><StarRating value={d.rating} onChange={v => set({ rating: v })} /></div>
          <label className="flex flex-col gap-1"><span className="field-label">Review</span>
            <textarea className="input min-h-[88px]" value={d.review} onChange={e => set({ review: e.target.value })} placeholder="What you thought of it" /></label>
          <label className="flex flex-col gap-1"><span className="field-label">Notes</span>
            <textarea className="input min-h-[64px]" value={d.notes} onChange={e => set({ notes: e.target.value })} /></label>
          <section>
            <span className="field-label">Recent sessions</span>
            {recent.length === 0 ? (
              <p className="flex items-center gap-2 text-meta text-fg-muted"><BookOpen className="h-4 w-4" aria-hidden />No reading synced for this book yet.</p>
            ) : (
              <ul className="divide-y divide-line rounded-control border border-line">
                {recent.map(s => (
                  <li key={s.start} className="flex items-center gap-3 px-3 py-2 text-meta tabular-nums">
                    <span className="text-fg">{formatDateTime(new Date(s.start * 1000).toISOString())}</span>
                    <span className="text-fg-muted">{s.pages} pages</span>
                    <span className="ml-auto font-semibold text-fg">{formatDuration(s.seconds)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {(notes.data?.length ?? 0) > 0 && (
            <section><span className="field-label">Asked on the Kobo</span>
              <AskedList rows={notes.data ?? []} onDelete={id => removeNote.mutate(id)} showBook={false} /></section>
          )}
        </div>
      </div>
    </ModalShell>
  )
}

function Fact({ label, value }: { label: string; value: string | null }) {
  if (!value) return null
  return (<><dt className="text-fg-muted">{label}</dt><dd className="min-w-0 break-words text-fg">{value}</dd></>)
}
