import { useState } from 'react'
import { useCreateGame } from '../hooks/useGames'
import { InfoBubble } from '../../../shared/components/InfoBubble'
import { ModalShell } from '../../../shared/modals'
import { Button } from '../../../shared/ui'
import { STATUS_LABEL, STATUSES } from '../gamesMeta'
import type { PlayStatus } from '../types'

// Manual "add a game" flow — a genuinely NEW capability. The old RP5 site had
// no add-game UI reachable from this app at all (games arrived via RP5's own
// admin.html / IGDB Bridge, both retired). Covers every field the schema
// actually has (not just title/system) per the real complaint that this
// form only exposed 3-4 fields while the game's own detail page shows far
// more — description, genres, cover art etc. can now all be set at
// creation time instead of requiring an immediate follow-up edit.

const inputCls = 'w-full min-h-[44px] px-3 text-sm border border-ink-200 rounded-xl bg-cream-50 focus:outline-none focus:ring-2 focus:ring-accent-400'
const labelCls = 'text-[11px] font-semibold uppercase tracking-wider text-ink-400 mb-1 block'

interface Props {
  open: boolean
  onClose: () => void
  /** Extra classes on the panel — the Games page passes its own theme scope. */
  className?: string
}

export function AddGameModal({ open, onClose, className = '' }: Props) {
  const [title, setTitle]           = useState('')
  const [year, setYear]             = useState('')
  const [publisher, setPublisher]   = useState('')
  const [developer, setDeveloper]   = useState('')
  const [seriesName, setSeriesName] = useState('')
  const [description, setDescription] = useState('')
  const [genres, setGenres]         = useState('')
  const [coverUrl, setCoverUrl]     = useState('')
  const [status, setStatus]         = useState<PlayStatus>('backlog')
  const [iconic, setIconic]         = useState(false)
  const [coop, setCoop]             = useState(false)
  const [system, setSystem]         = useState('')
  const [emulator, setEmulator]     = useState('')
  const create = useCreateGame()

  function reset() {
    setTitle(''); setYear(''); setPublisher(''); setDeveloper(''); setSeriesName('')
    setDescription(''); setGenres(''); setCoverUrl(''); setStatus('backlog')
    setIconic(false); setCoop(false); setSystem(''); setEmulator('')
  }

  async function handleSave() {
    if (!title.trim()) return
    try {
      await create.mutateAsync({
        title: title.trim(),
        release_year: year.trim() ? Number(year.trim()) : null,
        publisher: publisher.trim() || null,
        developer: developer.trim() || null,
        series_name: seriesName.trim() || null,
        description: description.trim() || null,
        genres: genres.trim() ? genres.split(',').map(g => g.trim()).filter(Boolean) : null,
        primary_cover_url: coverUrl.trim() || null,
        play_status: status,
        is_iconic: iconic,
        is_coop: coop,
        system: system.trim() || null,
        emulator: emulator.trim() || null,
      })
      reset()
      onClose()
    } catch { /* useMutationWithFeedback already toasts; avoids an unhandled rejection */ }
  }

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title="Add a game"
      size="md"
      dismissible={!create.isPending}
      panelClassName={className}
      bodyClassName="px-4 py-4 sm:px-5"
      footer={(
        <div className="flex gap-3">
          <Button variant="ghost" onClick={onClose} disabled={create.isPending}>Cancel</Button>
          <Button variant="primary" block onClick={handleSave} disabled={!title.trim()} loading={create.isPending}>
            {create.isPending ? 'Adding…' : 'Add game'}
          </Button>
        </div>
      )}
    >
      <div className="flex flex-col gap-4">
        <div>
          <label className={labelCls}>Title *</label>
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Chrono Trigger" className={inputCls} autoFocus />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={labelCls}>Release year</label>
            <input value={year} onChange={e => setYear(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" placeholder="1995" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Series</label>
            <input value={seriesName} onChange={e => setSeriesName(e.target.value)} placeholder="optional" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Publisher</label>
            <input value={publisher} onChange={e => setPublisher(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Developer</label>
            <input value={developer} onChange={e => setDeveloper(e.target.value)} className={inputCls} />
          </div>
        </div>

        <div>
          <label className={labelCls}>Genres (comma-separated)</label>
          <input value={genres} onChange={e => setGenres(e.target.value)} placeholder="RPG, Adventure" className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Description</label>
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} className={`${inputCls} resize-none`} />
        </div>
        <div>
          <label className={labelCls}>Cover image URL</label>
          <input value={coverUrl} onChange={e => setCoverUrl(e.target.value)} className={inputCls} />
        </div>

        <div>
          <label className={labelCls}>Status</label>
          <select value={status} onChange={e => setStatus(e.target.value as PlayStatus)} className={inputCls}>
            {STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 cursor-pointer min-h-[32px]">
            <input type="checkbox" checked={iconic} onChange={e => setIconic(e.target.checked)} className="rounded accent-star" />
            <span className="text-sm text-ink-700">⭐ Iconic</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer min-h-[32px]">
            <input type="checkbox" checked={coop} onChange={e => setCoop(e.target.checked)} className="rounded accent-info" />
            <span className="text-sm text-ink-700">2P Co-op</span>
          </label>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={`${labelCls} flex items-center gap-1`}>
              System
              <InfoBubble label="What does System mean?">
                Which console/handheld this game runs on (e.g. "SNES", "PS2"). You can add more systems for the same game later from its detail page.
              </InfoBubble>
            </label>
            <input value={system} onChange={e => setSystem(e.target.value)} placeholder="SNES" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Emulator</label>
            <input value={emulator} onChange={e => setEmulator(e.target.value)} placeholder="optional" className={inputCls} />
          </div>
        </div>
        <p className="text-[11px] text-ink-400">
          Everything else (screenshots, play notes, start/finish dates…) can be filled in from the game's detail page afterward.
        </p>
      </div>
    </ModalShell>
  )
}
