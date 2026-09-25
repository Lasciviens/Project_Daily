import { useState } from 'react'
import { Dialog, DialogPanel, DialogBackdrop } from '@headlessui/react'
import { useCreateGame } from '../hooks/useGames'
import { InfoBubble } from '../../../shared/components/InfoBubble'
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
  /** Extra classes on the dialog root — the Games page passes its own theme scope. */
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
    <Dialog open={open} onClose={onClose} className={`relative z-[60] ${className}`}>
      <DialogBackdrop transition className="fixed inset-0 bg-ink-900/30 transition duration-200 data-[closed]:opacity-0" />
      <div className="fixed inset-0 flex items-end sm:items-center justify-center p-0 sm:p-4">
        <DialogPanel transition className="w-full rounded-t-2xl sm:rounded-2xl sm:max-w-lg max-h-[90vh] overflow-y-auto bg-cream-50 border border-ink-200 transition duration-200 data-[closed]:opacity-0 data-[closed]:translate-y-4 sm:data-[closed]:translate-y-0 sm:data-[closed]:scale-95">
          <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-ink-100">
            <h2 className="text-base font-bold text-ink-900">Add a game</h2>
            <button onClick={onClose} className="min-w-[44px] min-h-[44px] flex items-center justify-center text-ink-400 hover:text-ink-700 text-xl">×</button>
          </div>

          <div className="px-5 py-4 flex flex-col gap-4">
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
                <input type="checkbox" checked={iconic} onChange={e => setIconic(e.target.checked)} className="rounded accent-yellow-500" />
                <span className="text-sm text-ink-700">⭐ Iconic</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer min-h-[32px]">
                <input type="checkbox" checked={coop} onChange={e => setCoop(e.target.checked)} className="rounded accent-cyan-500" />
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

          <div className="px-5 py-4 border-t border-ink-100 flex gap-3 sticky bottom-0 bg-cream-50">
            <button onClick={onClose} className="min-h-[44px] px-4 text-sm font-medium text-ink-500 hover:bg-ink-100 rounded-xl">Cancel</button>
            <button onClick={handleSave} disabled={!title.trim() || create.isPending}
              className="flex-1 min-h-[44px] bg-accent-500 text-white rounded-xl text-sm font-semibold hover:bg-accent-600 disabled:opacity-50">
              {create.isPending ? 'Adding…' : 'Add game'}
            </button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  )
}
