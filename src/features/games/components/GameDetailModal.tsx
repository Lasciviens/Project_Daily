import { useState } from 'react'
import { Dialog, DialogPanel, DialogBackdrop } from '@headlessui/react'
import {
  useGameDetail, useUpdateGame, useDeleteGame, useAddToQueue, useRemoveFromQueue,
  useAddPlatform, useUpdatePlatform, useDeletePlatform, useSetPrimaryVariant,
} from '../hooks/useGames'
import { UnifiedPlanModal } from '../../../shared/components/plan-modal'
import { ConfirmDialog } from '../../../shared/components/ConfirmDialog'
import { InfoBubble } from '../../../shared/components/InfoBubble'
import {
  STATUS_COLOR, STATUS_LABEL, TIER_COLOR, TIERS, STATUSES,
  PERFORMANCE_COLOR, ROM_STATUS_COLOR, EXTERNAL_SOURCE_LABEL,
} from '../gamesMeta'
import type { GamePatch, GamePlatform, GamePlatformInput } from '../types'

function Section({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div>
      <button onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between text-xs font-semibold text-ink-400 uppercase tracking-wide mb-1.5 hover:text-ink-600 transition-colors min-h-[32px]"
      >{title}<span className="text-ink-300">{open ? '▲' : '▼'}</span></button>
      {open && children}
    </div>
  )
}

// ─── Platforms — add/edit/delete/set-primary, replaces the old read-only table ───

function PlatformRow({ platform, gameId }: { platform: GamePlatform; gameId: string }) {
  const [editing, setEditing] = useState(false)
  const update = useUpdatePlatform()
  const del = useDeletePlatform()
  const setPrimary = useSetPrimaryVariant()
  const [confirmDelete, setConfirmDelete] = useState(false)

  const [system, setSystem] = useState(platform.system)
  const [emulator, setEmulator] = useState(platform.emulator ?? '')
  const [performance, setPerformance] = useState(platform.performance ?? '')

  function save() {
    update.mutate({ id: platform.id, patch: { system, emulator: emulator || null, performance: (performance || null) as GamePlatformInput['performance'] } },
      { onSuccess: () => setEditing(false) })
  }

  return (
    <div className={`rounded-xl border p-3 flex flex-col gap-2 ${platform.is_primary_variant ? 'border-accent-300 bg-accent-50/40' : 'border-ink-200 bg-cream-50'}`}>
      {editing ? (
        <div className="flex flex-wrap gap-2 items-end">
          <input value={system} onChange={e => setSystem(e.target.value)} placeholder="System" className="min-h-[40px] px-2 text-sm border border-ink-200 rounded-lg bg-cream-50 w-28" />
          <input value={emulator} onChange={e => setEmulator(e.target.value)} placeholder="Emulator" className="min-h-[40px] px-2 text-sm border border-ink-200 rounded-lg bg-cream-50 w-28" />
          <select value={performance} onChange={e => setPerformance(e.target.value)} className="min-h-[40px] px-2 text-sm border border-ink-200 rounded-lg bg-cream-50">
            <option value="">Performance: —</option>
            <option value="good">Good</option>
            <option value="warn">Warn</option>
            <option value="bad">Bad</option>
          </select>
          <button onClick={save} disabled={update.isPending} className="min-h-[40px] px-3 text-xs font-semibold bg-accent-500 text-white rounded-lg disabled:opacity-50">Save</button>
          <button onClick={() => setEditing(false)} className="min-h-[40px] px-3 text-xs text-ink-500">Cancel</button>
        </div>
      ) : (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-ink-800">{platform.system}</span>
          {platform.emulator && <span className="text-xs text-ink-500">· {platform.emulator}</span>}
          {platform.is_primary_variant && <span className="text-[10px] font-bold bg-accent-500 text-white px-1.5 py-0.5 rounded-full">Primary</span>}
          {platform.performance && (
            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${PERFORMANCE_COLOR[platform.performance] ?? ''}`}>{platform.performance}</span>
          )}
          {platform.rom_status && (
            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${ROM_STATUS_COLOR[platform.rom_status] ?? 'bg-ink-100 text-ink-500'}`}>{platform.rom_status}</span>
          )}
          <div className="ml-auto flex items-center gap-1">
            {!platform.is_primary_variant && (
              <button onClick={() => setPrimary.mutate({ gameId, platformId: platform.id })} disabled={setPrimary.isPending}
                title="Make primary" className="min-h-[36px] px-2 text-[11px] text-accent-600 hover:bg-accent-100 rounded-lg">★ Primary</button>
            )}
            <button onClick={() => setEditing(true)} title="Edit" className="min-w-[36px] min-h-[36px] flex items-center justify-center text-ink-500 hover:text-accent-600 rounded-lg">✎</button>
            <button onClick={() => setConfirmDelete(true)} title="Delete" className="min-w-[36px] min-h-[36px] flex items-center justify-center text-ink-500 hover:text-red-500 rounded-lg">×</button>
          </div>
        </div>
      )}
      <ConfirmDialog open={confirmDelete} title="Remove this platform?" message={`Removes ${platform.system} from this game — the game itself stays.`}
        onConfirm={() => del.mutate(platform.id)} onClose={() => setConfirmDelete(false)} />
    </div>
  )
}

function AddPlatformInline({ gameId, onDone }: { gameId: string; onDone: () => void }) {
  const [system, setSystem] = useState('')
  const [emulator, setEmulator] = useState('')
  const add = useAddPlatform()

  async function save() {
    if (!system.trim()) return
    try {
      await add.mutateAsync({ gameId, input: { system: system.trim(), emulator: emulator.trim() || null } })
      onDone()
    } catch { /* useMutationWithFeedback already toasts */ }
  }

  return (
    <div className="rounded-xl border border-dashed border-ink-300 p-3 flex flex-wrap gap-2 items-end">
      <input value={system} onChange={e => setSystem(e.target.value)} placeholder="System (e.g. PS2)" className="min-h-[40px] px-2 text-sm border border-ink-200 rounded-lg bg-cream-50 w-32" autoFocus />
      <input value={emulator} onChange={e => setEmulator(e.target.value)} placeholder="Emulator (optional)" className="min-h-[40px] px-2 text-sm border border-ink-200 rounded-lg bg-cream-50 w-32" />
      <button onClick={save} disabled={!system.trim() || add.isPending} className="min-h-[40px] px-3 text-xs font-semibold bg-accent-500 text-white rounded-lg disabled:opacity-50">Add</button>
      <button onClick={onDone} className="min-h-[40px] px-3 text-xs text-ink-500">Cancel</button>
    </div>
  )
}

// ─── Edit panel ───────────────────────────────────────────────────────────────

function EditPanel({
  gameId, initial, onSave, onCancel, saving,
}: {
  gameId: string
  initial: { play_status: string; tier?: string | null; rating?: number | null; is_iconic: boolean; is_coop: boolean; play_notes?: string | null; needs_review: boolean }
  onSave: (id: string, patch: GamePatch) => void
  onCancel: () => void
  saving: boolean
}) {
  const [status, setStatus]     = useState(initial.play_status)
  const [tier, setTier]         = useState(initial.tier ?? '')
  const [rating, setRating]     = useState(initial.rating?.toString() ?? '')
  const [iconic, setIconic]     = useState(initial.is_iconic)
  const [coop, setCoop]         = useState(initial.is_coop)
  const [notes, setNotes]       = useState(initial.play_notes ?? '')
  const [needsReview, setNeedsReview] = useState(initial.needs_review)

  function save() {
    const ratingNum = rating !== '' ? Number(rating) : null
    onSave(gameId, {
      play_status: status as GamePatch['play_status'],
      tier:        (tier || null) as GamePatch['tier'],
      rating:      ratingNum != null && !isNaN(ratingNum) ? Math.min(10, Math.max(0, ratingNum)) : null,
      is_iconic:   iconic,
      is_coop:     coop,
      play_notes:  notes || null,
      needs_review: needsReview,
    })
  }

  return (
    <div className="p-5 border-t border-ink-100 space-y-4 bg-cream-50">
      <p className="text-xs font-semibold text-ink-500 uppercase tracking-wide">Edit</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-ink-400 mb-1 block">Status</label>
          <select value={status} onChange={e => setStatus(e.target.value)} className="w-full min-h-[44px] text-sm px-3 py-2 rounded-lg border border-ink-200 bg-cream-50 focus:outline-none focus:ring-2 focus:ring-accent-400">
            {STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-ink-400 mb-1 block">Tier</label>
          <select value={tier} onChange={e => setTier(e.target.value)} className="w-full min-h-[44px] text-sm px-3 py-2 rounded-lg border border-ink-200 bg-cream-50 focus:outline-none focus:ring-2 focus:ring-accent-400">
            <option value="">— None —</option>
            {TIERS.map(t => <option key={t} value={t}>Tier {t}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-ink-400 mb-1 block">My Rating (0–10)</label>
          <input type="number" min={0} max={10} step={0.5} value={rating} onChange={e => setRating(e.target.value)} placeholder="—"
            className="w-full min-h-[44px] text-sm px-3 py-2 rounded-lg border border-ink-200 bg-cream-50 focus:outline-none focus:ring-2 focus:ring-accent-400" />
        </div>
        <div className="flex flex-col gap-2 justify-center">
          <label className="flex items-center gap-2 cursor-pointer min-h-[32px]">
            <input type="checkbox" checked={iconic} onChange={e => setIconic(e.target.checked)} className="rounded accent-yellow-500" />
            <span className="text-sm text-ink-700">⭐ Iconic</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer min-h-[32px]">
            <input type="checkbox" checked={coop} onChange={e => setCoop(e.target.checked)} className="rounded accent-cyan-500" />
            <span className="text-sm text-ink-700">2P Co-op</span>
          </label>
        </div>
      </div>

      <div>
        <label className="text-xs text-ink-400 mb-1 flex items-center gap-1">
          Personal Notes
        </label>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="Your thoughts…"
          className="w-full text-sm px-3 py-2 rounded-lg border border-ink-200 bg-cream-50 focus:outline-none focus:ring-2 focus:ring-accent-400 resize-none" />
      </div>

      <label className="flex items-center gap-2 cursor-pointer min-h-[32px]">
        <input type="checkbox" checked={needsReview} onChange={e => setNeedsReview(e.target.checked)} className="rounded accent-orange-500" />
        <span className="text-sm text-ink-700">Flag for review</span>
        <InfoBubble label="What does this do?">
          Marks this game so it shows up in the "Needs Review" tab — use it for anything you want to come back to later (a wrong match, a missing detail).
        </InfoBubble>
      </label>

      <div className="flex gap-2">
        <button onClick={save} disabled={saving} className="flex-1 min-h-[44px] py-2 bg-accent-500 hover:bg-accent-600 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50">
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
        <button onClick={onCancel} className="min-h-[44px] px-4 py-2 bg-ink-100 hover:bg-ink-200 text-ink-600 text-sm rounded-lg transition-colors">Cancel</button>
      </div>
    </div>
  )
}

// ─── Modal ────────────────────────────────────────────────────────────────────

interface Props { gameId: string; onClose: () => void }

export function GameDetailModal({ gameId, onClose }: Props) {
  const { data: game, isLoading } = useGameDetail(gameId)
  const update = useUpdateGame()
  const del = useDeleteGame()
  const addToQueue = useAddToQueue()
  const removeFromQueue = useRemoveFromQueue()
  const [editing, setEditing]   = useState(false)
  const [planOpen, setPlanOpen] = useState(false)
  const [addingPlatform, setAddingPlatform] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  function handleQueueToggle() {
    if (!game) return
    if (game.play_order == null) addToQueue.mutate(game.id)
    else removeFromQueue.mutate(game.id)
  }

  const screenshots = [game?.screenshot_url, game?.fanart_url].filter((u): u is string => !!u)
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null)
  function prevScreenshot() { if (lightboxIdx !== null) setLightboxIdx((lightboxIdx - 1 + screenshots.length) % screenshots.length) }
  function nextScreenshot() { if (lightboxIdx !== null) setLightboxIdx((lightboxIdx + 1) % screenshots.length) }

  function handleSave(id: string, patch: GamePatch) {
    update.mutate({ id, patch }, { onSuccess: () => setEditing(false) })
  }

  function handleDelete() {
    del.mutate(gameId, { onSuccess: onClose })
  }

  return (
    <>
    <Dialog open onClose={onClose} className="relative z-40">
      <DialogBackdrop transition className="fixed inset-0 bg-ink-950/30 backdrop-blur-sm transition duration-200 data-[closed]:opacity-0" />
      <div className="fixed inset-0 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <DialogPanel transition className="w-full sm:max-w-2xl max-h-[calc(100dvh-2rem)] overflow-y-auto bg-cream-50 rounded-t-2xl sm:rounded-2xl border border-ink-200 shadow-2xl transition duration-200 data-[closed]:opacity-0 data-[closed]:translate-y-4 sm:data-[closed]:translate-y-0 sm:data-[closed]:scale-95">
        <div className="absolute top-3 right-3 z-10 flex gap-2">
          {game && !editing && (
            <button onClick={() => setEditing(true)} className="min-h-[44px] px-3 flex items-center justify-center bg-ink-100 hover:bg-ink-200 rounded-full text-ink-500 text-xs font-medium transition-colors">✏️ Edit</button>
          )}
          <button onClick={onClose} className="min-w-[44px] min-h-[44px] flex items-center justify-center bg-ink-100 hover:bg-ink-200 rounded-full text-ink-500 transition-colors">✕</button>
        </div>

        {isLoading && (
          <div className="p-4 space-y-3">
            <div className="h-40 rounded-xl bg-cream-200 animate-pulse" />
            <div className="h-4 w-2/3 rounded bg-cream-200 animate-pulse" />
            <div className="h-4 w-1/2 rounded bg-cream-200 animate-pulse" />
          </div>
        )}

        {game && (
          <div>
            <div className="flex flex-col sm:flex-row gap-4 p-5 pb-4 border-b border-ink-100 pt-14 sm:pt-5">
              <div className="flex-shrink-0 w-24 sm:w-28 rounded-xl overflow-hidden border border-ink-200 bg-ink-100 self-start" style={{ aspectRatio: '3/4' }}>
                {game.primary_cover_url
                  ? <img src={game.primary_cover_url} alt={game.title} className="w-full h-full object-cover" />
                  : <div className="w-full h-full flex items-center justify-center text-3xl bg-ink-100">🎮</div>}
              </div>
              <div className="flex-1 min-w-0 sm:pt-1">
                <h2 className="text-lg font-bold text-ink-900 leading-snug mb-0.5 pr-0 sm:pr-8">{game.title}</h2>
                {game.series_name && <p className="text-xs text-ink-400 mb-1.5">⛓ {game.series_name}</p>}
                <div className="flex flex-wrap gap-1.5 mb-2">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLOR[game.play_status] ?? 'bg-ink-100 text-ink-500'}`}>{STATUS_LABEL[game.play_status] ?? game.play_status}</span>
                  {game.tier && <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${TIER_COLOR[game.tier] ?? 'bg-ink-200'}`}>Tier {game.tier}</span>}
                  {game.is_iconic && <span className="text-sm">⭐</span>}
                  {game.is_coop && <span className="text-xs font-bold bg-cyan-500 text-white px-2 py-0.5 rounded-full">2P</span>}
                  {game.needs_review && <span className="text-xs font-bold bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full">Needs review</span>}
                </div>
                <div className="space-y-0.5 text-xs text-ink-500">
                  {game.release_year && <p>📅 {game.release_year}</p>}
                  {game.publisher && <p>🏢 {game.publisher}</p>}
                  {game.age_rating && <p>🔞 {game.age_rating}</p>}
                  {game.external_source && (
                    <p className="flex items-center gap-1">
                      🔗 {EXTERNAL_SOURCE_LABEL[game.external_source] ?? game.external_source}
                      <InfoBubble label="What is this?">Where this game's metadata came from.</InfoBubble>
                    </p>
                  )}
                </div>
                {game.rating != null && (
                  <p className="text-base font-bold text-accent-600 mt-2">★ {game.rating} <span className="text-[10px] text-ink-400 font-normal">my rating</span></p>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button onClick={handleQueueToggle}
                    className={`text-xs font-semibold px-3 py-1.5 min-h-[44px] rounded-lg transition-colors ${game.play_order != null ? 'bg-red-100 hover:bg-red-200 text-red-600' : 'bg-orange-100 hover:bg-orange-200 text-orange-700'}`}>
                    {game.play_order != null ? `✕ Remove from Queue (#${game.play_order})` : '🎮 Add to Queue'}
                  </button>
                  <button onClick={() => setPlanOpen(true)} className="text-xs font-semibold px-3 py-1.5 min-h-[44px] rounded-lg bg-accent-100 hover:bg-accent-200 text-accent-700 transition-colors">📅 Plan session</button>
                  <button onClick={() => setConfirmDelete(true)} className="text-xs font-semibold px-3 py-1.5 min-h-[44px] rounded-lg bg-ink-100 hover:bg-red-100 text-ink-500 hover:text-red-600 transition-colors">🗑 Delete</button>
                </div>
              </div>
            </div>

            {editing && (
              <EditPanel
                gameId={game.id}
                initial={{ play_status: game.play_status, tier: game.tier, rating: game.rating, is_iconic: game.is_iconic, is_coop: game.is_coop, play_notes: game.play_notes, needs_review: game.needs_review }}
                onSave={handleSave}
                onCancel={() => setEditing(false)}
                saving={update.isPending}
              />
            )}

            <div className="p-5 space-y-5">
              <Section title="Platforms">
                <div className="space-y-2">
                  {game.platforms.map(p => <PlatformRow key={p.id} platform={p} gameId={game.id} />)}
                  {addingPlatform
                    ? <AddPlatformInline gameId={game.id} onDone={() => setAddingPlatform(false)} />
                    : <button onClick={() => setAddingPlatform(true)} className="min-h-[44px] w-full text-xs font-medium text-accent-600 border border-dashed border-accent-300 rounded-xl hover:bg-accent-50 transition-colors">+ Add platform</button>}
                </div>
              </Section>

              {game.description && (
                <Section title="About"><p className="text-sm text-ink-700 leading-relaxed">{game.description}</p></Section>
              )}
              {game.storyline && (
                <Section title="Storyline" defaultOpen={false}><p className="text-sm text-ink-600 leading-relaxed italic">{game.storyline}</p></Section>
              )}
              {screenshots.length > 0 && (
                <Section title="Screenshots">
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {screenshots.map((url, i) => (
                      <button key={i} onClick={() => setLightboxIdx(i)} className="flex-shrink-0 rounded-lg overflow-hidden border border-ink-200 hover:border-accent-400 transition-colors" style={{ height: 80, width: 140 }}>
                        <img src={url} alt="" className="w-full h-full object-cover" />
                      </button>
                    ))}
                  </div>
                </Section>
              )}
              {((game.genres?.length ?? 0) > 0 || game.players || (game.modes?.length ?? 0) > 0) && (
                <Section title="Tags">
                  <div className="flex flex-wrap gap-1.5">
                    {game.genres?.map((g, i) => <span key={i} className="text-xs bg-purple-50 text-purple-700 border border-purple-200 px-2 py-0.5 rounded-full">{g}</span>)}
                    {game.modes?.map((m, i) => <span key={i} className="text-xs bg-orange-50 text-orange-700 border border-orange-200 px-2 py-0.5 rounded-full">{m}</span>)}
                    {game.players && <span className="text-xs bg-ink-50 text-ink-500 border border-ink-200 px-2 py-0.5 rounded-full">{game.players} player(s)</span>}
                  </div>
                </Section>
              )}
              {game.play_notes && (
                <Section title="My Notes"><p className="text-sm text-ink-700 bg-cream-50 rounded-lg p-3 leading-relaxed whitespace-pre-line">{game.play_notes}</p></Section>
              )}
              {game.game_log && (
                <Section title="Play Log" defaultOpen={false}><p className="text-sm text-ink-700 bg-cream-50 rounded-lg p-3 leading-relaxed whitespace-pre-line">{game.game_log}</p></Section>
              )}
              {game.coop_notes && (
                <Section title="Co-op Notes"><p className="text-sm text-ink-700 bg-cyan-50 rounded-lg p-3 leading-relaxed">{game.coop_notes}</p></Section>
              )}
            </div>
          </div>
        )}
      </DialogPanel>
      </div>

      {lightboxIdx !== null && screenshots[lightboxIdx] && (
        <div className="fixed inset-0 bg-black/90 z-[60] flex items-center justify-center" onClick={() => setLightboxIdx(null)}>
          <button onClick={e => { e.stopPropagation(); prevScreenshot() }} className="absolute left-4 text-white text-2xl bg-black/40 hover:bg-black/60 w-11 h-11 rounded-full flex items-center justify-center">‹</button>
          <img src={screenshots[lightboxIdx]} alt="" className="max-w-full max-h-full object-contain rounded-lg" onClick={e => e.stopPropagation()} />
          <button onClick={e => { e.stopPropagation(); nextScreenshot() }} className="absolute right-4 text-white text-2xl bg-black/40 hover:bg-black/60 w-11 h-11 rounded-full flex items-center justify-center">›</button>
          <button onClick={() => setLightboxIdx(null)} className="absolute top-4 right-4 text-white text-xl bg-black/40 hover:bg-black/60 w-11 h-11 rounded-full flex items-center justify-center">✕</button>
          <span className="absolute bottom-4 text-white/60 text-xs">{lightboxIdx + 1} / {screenshots.length}</span>
        </div>
      )}
    </Dialog>

    {game && (
      <UnifiedPlanModal open={planOpen} onClose={() => setPlanOpen(false)} mode="schedule" config={{ heading: 'Plan session' }} defaults={{ title: game.title, category: 'games', color: 'blue' }} />
    )}
    <ConfirmDialog open={confirmDelete} title={`Delete "${game?.title}"?`} message="This can't be undone — the game and all its platform entries will be removed."
      onConfirm={handleDelete} onClose={() => setConfirmDelete(false)} />
    </>
  )
}
