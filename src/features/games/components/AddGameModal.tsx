import { useState } from 'react'
import { Dialog, DialogPanel, DialogBackdrop } from '@headlessui/react'
import { useCreateGame } from '../hooks/useGames'
import { InfoBubble } from '../../../shared/components/InfoBubble'

// Manual "add a game" flow — a genuinely NEW capability. The old RP5 site had
// no add-game UI reachable from this app at all (games arrived via RP5's own
// admin.html / IGDB Bridge, both retired). Kept deliberately small: title +
// system are the only things a game truly needs to exist here; everything
// else (cover, description, ScreenScraper match) is filled in later from the
// detail modal — matching the "search & match later" flow discussed for
// ScreenScraper, since a live search integration isn't wired up yet.

const inputCls = 'w-full min-h-[44px] px-3 text-sm border border-ink-200 rounded-xl bg-cream-50 focus:outline-none focus:ring-2 focus:ring-accent-400'

interface Props { open: boolean; onClose: () => void }

export function AddGameModal({ open, onClose }: Props) {
  const [title, setTitle]     = useState('')
  const [year, setYear]       = useState('')
  const [system, setSystem]   = useState('')
  const [emulator, setEmulator] = useState('')
  const create = useCreateGame()

  function reset() { setTitle(''); setYear(''); setSystem(''); setEmulator('') }

  async function handleSave() {
    if (!title.trim()) return
    try {
      await create.mutateAsync({
        title: title.trim(),
        release_year: year.trim() ? Number(year.trim()) : null,
        system: system.trim() || null,
        emulator: emulator.trim() || null,
      })
      reset()
      onClose()
    } catch { /* useMutationWithFeedback already toasts; avoids an unhandled rejection */ }
  }

  return (
    <Dialog open={open} onClose={onClose} className="relative z-[60]">
      <DialogBackdrop transition className="fixed inset-0 bg-ink-900/30 transition duration-200 data-[closed]:opacity-0" />
      <div className="fixed inset-0 flex items-end sm:items-center justify-center p-0 sm:p-4">
        <DialogPanel transition className="w-full rounded-t-2xl sm:rounded-2xl sm:max-w-md max-h-[90vh] overflow-y-auto bg-cream-50 border border-ink-200 transition duration-200 data-[closed]:opacity-0 data-[closed]:translate-y-4 sm:data-[closed]:translate-y-0 sm:data-[closed]:scale-95">
          <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-ink-100">
            <h2 className="text-base font-bold text-ink-900">Add a game</h2>
            <button onClick={onClose} className="min-w-[44px] min-h-[44px] flex items-center justify-center text-ink-400 hover:text-ink-700 text-xl">×</button>
          </div>

          <div className="px-5 py-4 flex flex-col gap-3">
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-ink-400 mb-1 block">Title *</label>
              <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Chrono Trigger" className={inputCls} autoFocus />
            </div>
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-ink-400 mb-1 block">Release year</label>
              <input value={year} onChange={e => setYear(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" placeholder="1995" className={`${inputCls} w-28`} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-ink-400 mb-1 flex items-center gap-1">
                  System
                  <InfoBubble label="What does System mean?">
                    Which console/handheld this game runs on (e.g. "SNES", "PS2"). You can add more systems for the same game later from its detail page.
                  </InfoBubble>
                </label>
                <input value={system} onChange={e => setSystem(e.target.value)} placeholder="SNES" className={inputCls} />
              </div>
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-ink-400 mb-1 block">Emulator</label>
                <input value={emulator} onChange={e => setEmulator(e.target.value)} placeholder="optional" className={inputCls} />
              </div>
            </div>
            <p className="text-[11px] text-ink-400">
              Cover art, description and genres can be filled in from the game's detail page afterward.
            </p>
          </div>

          <div className="px-5 py-4 border-t border-ink-100 flex gap-3">
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
