import { useState } from 'react'
import { Dialog, DialogPanel, DialogBackdrop } from '@headlessui/react'
import { useGameDetail, useAddToQueue, useRemoveFromQueue } from '../../home/hooks/useGames'
import { toast }         from '../../../app/store'
import { PlanModal }     from '../../../shared/components/PlanModal'
import type { PlatformDetail, GamePatch } from '../../home/api/gamesApi'

const STATUS_COLOR: Record<string, string> = {
  playing:   'bg-orange-100 text-orange-700',
  completed: 'bg-green-100 text-green-700',
  wishlist:  'bg-purple-100 text-purple-700',
  backlog:   'bg-ink-100 text-ink-500',
  dropped:   'bg-red-100 text-red-600',
}
const STATUS_LABEL: Record<string, string> = {
  playing: 'Playing', completed: 'Completed', wishlist: 'Wishlist',
  backlog: 'Backlog', dropped: 'Dropped',
}
const TIER_COLOR: Record<string, string> = {
  S: 'bg-yellow-400 text-yellow-900', A: 'bg-orange-400 text-white',
  B: 'bg-green-500 text-white',       C: 'bg-blue-400 text-white',
  D: 'bg-ink-400 text-white',         F: 'bg-red-500 text-white',
}
const PERF_COLOR: Record<string, string> = {
  great:      'bg-green-100 text-green-700 border-green-200',
  perfect:    'bg-green-100 text-green-700 border-green-200',
  good:       'bg-teal-100 text-teal-700 border-teal-200',
  playable:   'bg-yellow-100 text-yellow-700 border-yellow-200',
  ok:         'bg-yellow-100 text-yellow-700 border-yellow-200',
  bad:        'bg-orange-100 text-orange-700 border-orange-200',
  poor:       'bg-orange-100 text-orange-700 border-orange-200',
  unplayable: 'bg-red-100 text-red-600 border-red-200',
  runs:       'bg-teal-100 text-teal-700 border-teal-200',
}
const ROM_COLOR: Record<string, string> = {
  owned:   'bg-green-100 text-green-700',
  digital: 'bg-blue-100 text-blue-700',
  missing: 'bg-red-100 text-red-600',
  patched: 'bg-purple-100 text-purple-700',
}

function perfBadgeClass(perf?: string) {
  if (!perf) return 'bg-ink-100 text-ink-500 border-ink-200'
  return PERF_COLOR[perf.toLowerCase()] ?? 'bg-ink-100 text-ink-500 border-ink-200'
}

function igdbScreenshot(id: string, size = 'screenshot_med') {
  if (id.startsWith('http')) return id
  return `https://images.igdb.com/igdb/image/upload/t_${size}/${id}.jpg`
}

function Section({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div>
      <button onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between text-xs font-semibold text-ink-400 uppercase tracking-wide mb-1.5 hover:text-ink-600 transition-colors"
      >{title}<span className="text-ink-300">{open ? '▲' : '▼'}</span></button>
      {open && children}
    </div>
  )
}

function PlatformsTable({ platforms }: { platforms: PlatformDetail[] }) {
  return (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full text-xs min-w-[400px]">
        <thead>
          <tr className="text-left border-b border-ink-100">
            <th className="pb-1.5 pr-3 text-ink-400 font-medium">System</th>
            <th className="pb-1.5 pr-3 text-ink-400 font-medium">Emulator</th>
            <th className="pb-1.5 pr-3 text-ink-400 font-medium">Performance</th>
            <th className="pb-1.5 pr-3 text-ink-400 font-medium">ROM</th>
            <th className="pb-1.5 text-ink-400 font-medium">Region</th>
          </tr>
        </thead>
        <tbody>
          {platforms.map((p, i) => (
            <tr key={i} className={`border-b border-ink-50 last:border-0 ${p.is_preferred ? 'bg-green-50/50' : ''}`}>
              <td className="py-1.5 pr-3 font-medium text-ink-700">
                {p.system ?? '—'}{p.is_preferred && <span className="ml-1 text-[9px] text-green-600">★</span>}
                {p.version_title && <p className="text-[10px] text-ink-400 font-normal">{p.version_title}</p>}
              </td>
              <td className="py-1.5 pr-3 text-ink-600">{p.emulator ?? '—'}</td>
              <td className="py-1.5 pr-3">
                {p.performance
                  ? <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${perfBadgeClass(p.performance)}`}>{p.performance}</span>
                  : '—'}
                {p.performance_notes && <p className="text-[10px] text-ink-400 mt-0.5">{p.performance_notes}</p>}
              </td>
              <td className="py-1.5 pr-3">
                {p.rom_status
                  ? <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${ROM_COLOR[p.rom_status.toLowerCase()] ?? 'bg-ink-100 text-ink-500'}`}>{p.rom_status}</span>
                  : '—'}
              </td>
              <td className="py-1.5 text-ink-500">{p.region ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Edit panel ───────────────────────────────────────────────────────────────

function EditPanel({
  gameId, initial,
  onSave, onCancel,
}: {
  gameId: string
  initial: { play_status: string; tier?: string | null; rating?: number | null; is_iconic: boolean; is_coop: boolean; play_notes?: string | null }
  onSave: (id: string, patch: GamePatch) => void
  onCancel: () => void
}) {
  const [status,    setStatus]    = useState(initial.play_status)
  const [tier,      setTier]      = useState(initial.tier ?? '')
  const [rating,    setRating]    = useState(initial.rating?.toString() ?? '')
  const [iconic,    setIconic]    = useState(initial.is_iconic)
  const [coop,      setCoop]      = useState(initial.is_coop)
  const [notes,     setNotes]     = useState(initial.play_notes ?? '')

  function save() {
    const ratingNum = rating !== '' ? Number(rating) : null
    onSave(gameId, {
      play_status: status,
      tier:        tier || null,
      rating:      ratingNum != null && !isNaN(ratingNum) ? Math.min(10, Math.max(1, ratingNum)) : null,
      is_iconic:   iconic,
      is_coop:     coop,
      play_notes:  notes || null,
    })
  }

  return (
    <div className="p-5 border-t border-ink-100 space-y-4 bg-cream-50">
      <p className="text-xs font-semibold text-ink-500 uppercase tracking-wide">Edit</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Status */}
        <div>
          <label className="text-xs text-ink-400 mb-1 block">Status</label>
          <select value={status} onChange={e => setStatus(e.target.value)}
            className="w-full text-sm px-3 py-2 rounded-lg border border-ink-200 bg-white focus:outline-none focus:ring-2 focus:ring-accent-400">
            <option value="playing">Playing</option>
            <option value="completed">Completed</option>
            <option value="wishlist">Wishlist</option>
            <option value="backlog">Backlog</option>
            <option value="dropped">Dropped</option>
          </select>
        </div>

        {/* Tier */}
        <div>
          <label className="text-xs text-ink-400 mb-1 block">Tier</label>
          <select value={tier} onChange={e => setTier(e.target.value)}
            className="w-full text-sm px-3 py-2 rounded-lg border border-ink-200 bg-white focus:outline-none focus:ring-2 focus:ring-accent-400">
            <option value="">— None —</option>
            {['S','A','B','C','D','F'].map(t => <option key={t} value={t}>Tier {t}</option>)}
          </select>
        </div>

        {/* Rating */}
        <div>
          <label className="text-xs text-ink-400 mb-1 block">My Rating (1–10)</label>
          <input type="number" min={1} max={10} value={rating} onChange={e => setRating(e.target.value)}
            placeholder="—"
            className="w-full text-sm px-3 py-2 rounded-lg border border-ink-200 bg-white focus:outline-none focus:ring-2 focus:ring-accent-400" />
        </div>

        {/* Flags */}
        <div className="flex flex-col gap-2 justify-center">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={iconic} onChange={e => setIconic(e.target.checked)} className="rounded accent-yellow-500" />
            <span className="text-sm text-ink-700">⭐ Iconic</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={coop} onChange={e => setCoop(e.target.checked)} className="rounded accent-cyan-500" />
            <span className="text-sm text-ink-700">2P Co-op</span>
          </label>
        </div>
      </div>

      {/* Notes */}
      <div>
        <label className="text-xs text-ink-400 mb-1 block">Personal Notes</label>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
          placeholder="Your thoughts…"
          className="w-full text-sm px-3 py-2 rounded-lg border border-ink-200 bg-white focus:outline-none focus:ring-2 focus:ring-accent-400 resize-none" />
      </div>

      <div className="flex gap-2">
        <button onClick={save}
          className="flex-1 py-2 bg-accent-500 hover:bg-accent-600 text-white text-sm font-semibold rounded-lg transition-colors">
          Save Changes
        </button>
        <button onClick={onCancel}
          className="px-4 py-2 bg-ink-100 hover:bg-ink-200 text-ink-600 text-sm rounded-lg transition-colors">
          Cancel
        </button>
      </div>
    </div>
  )
}

// ─── Modal ────────────────────────────────────────────────────────────────────

interface Props {
  gameId: string
  onClose: () => void
  updateGame?: (args: { id: string; patch: GamePatch }, callbacks?: { onSuccess?: () => void; onError?: (e: Error) => void }) => void
}

export function GameDetailModal({ gameId, onClose, updateGame }: Props) {
  const { data: game, isLoading } = useGameDetail(gameId)
  const { mutate: addToQueue }    = useAddToQueue()
  const { mutate: removeFromQueue } = useRemoveFromQueue()
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null)
  const [editing,     setEditing]     = useState(false)
  const [planOpen,    setPlanOpen]    = useState(false)

  function handleQueueToggle() {
    if (!game) return
    if (game.play_order == null) {
      const id = toast.loading('Sıraya ekleniyor…')
      addToQueue(game.id, {
        onSuccess: () => { toast.dismiss(id); toast.success('🎮 Sıraya Eklendi ✓') },
        onError:   (e) => { toast.dismiss(id); toast.error((e as Error).message) },
      })
    } else {
      const id = toast.loading('Sıradan çıkarılıyor…')
      removeFromQueue(game.id, {
        onSuccess: () => { toast.dismiss(id); toast.success('Sıradan Çıkarıldı') },
        onError:   (e) => { toast.dismiss(id); toast.error((e as Error).message) },
      })
    }
  }

  const screenshots: string[] = []
  if (game?.screenshots?.length) screenshots.push(...game.screenshots.map(s => igdbScreenshot(s)))
  if (game?.ss_screenshot_url)   screenshots.push(game.ss_screenshot_url)
  if (game?.ss_fanart_url)       screenshots.push(game.ss_fanart_url)

  function prevScreenshot() { if (lightboxIdx !== null) setLightboxIdx((lightboxIdx - 1 + screenshots.length) % screenshots.length) }
  function nextScreenshot() { if (lightboxIdx !== null) setLightboxIdx((lightboxIdx + 1) % screenshots.length) }

  function handleSave(id: string, patch: GamePatch) {
    if (!updateGame) return
    const toastId = toast.loading('Saving…')
    updateGame(
      { id, patch },
      {
        onSuccess: () => { toast.dismiss(toastId); toast.success('Saved ✓'); setEditing(false) },
        onError:   (e) => { toast.dismiss(toastId); toast.error((e as Error).message) },
      }
    )
  }

  return (
    <>
    <Dialog open onClose={onClose} className="relative z-40">
      <DialogBackdrop transition className="fixed inset-0 bg-ink-900/30 backdrop-blur-sm transition duration-200 data-[closed]:opacity-0" />

      <div className="fixed inset-0 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <DialogPanel transition className="w-full sm:max-w-2xl max-h-[calc(100dvh-2rem)] overflow-y-auto bg-white rounded-t-2xl sm:rounded-2xl border border-ink-200 shadow-2xl transition duration-200 data-[closed]:opacity-0 data-[closed]:translate-y-4 sm:data-[closed]:translate-y-0 sm:data-[closed]:scale-95">
        {/* Controls */}
        <div className="absolute top-3 right-3 z-10 flex gap-2">
          {updateGame && game && !editing && (
            <button onClick={() => setEditing(true)}
              className="h-9 px-3 flex items-center justify-center bg-ink-100 hover:bg-ink-200 rounded-full text-ink-500 text-xs font-medium transition-colors">
              ✏️ Edit
            </button>
          )}
          <button onClick={onClose}
            className="w-9 h-9 flex items-center justify-center bg-ink-100 hover:bg-ink-200 rounded-full text-ink-500 transition-colors">✕</button>
        </div>

        {isLoading && <div className="flex items-center justify-center h-48 text-ink-400">Loading…</div>}

        {game && (
          <div>
            {/* Hero */}
            <div className="flex flex-col sm:flex-row gap-4 p-5 pb-4 border-b border-ink-100 pt-14 sm:pt-5">
              <div className="flex-shrink-0 w-24 sm:w-28 rounded-xl overflow-hidden border border-ink-200 bg-ink-100 self-start" style={{ aspectRatio: '3/4' }}>
                {game.cover_url
                  ? <img src={game.cover_url} alt={game.title} className="w-full h-full object-cover" />
                  : <div className="w-full h-full flex items-center justify-center text-3xl bg-ink-100">🎮</div>}
              </div>
              <div className="flex-1 min-w-0 sm:pt-1">
                <h2 className="text-lg font-bold text-ink-900 leading-snug mb-0.5 pr-0 sm:pr-8">{game.title}</h2>
                {game.series_name && <p className="text-xs text-ink-400 mb-1.5">⛓ {game.series_name}</p>}
                <div className="flex flex-wrap gap-1.5 mb-2">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLOR[game.play_status] ?? 'bg-ink-100 text-ink-500'}`}>{STATUS_LABEL[game.play_status] ?? game.play_status}</span>
                  {game.tier && <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${TIER_COLOR[game.tier] ?? 'bg-ink-200'}`}>Tier {game.tier}</span>}
                  {game.is_iconic && <span className="text-sm">⭐</span>}
                  {game.is_coop   && <span className="text-xs font-bold bg-cyan-500 text-white px-2 py-0.5 rounded-full">2P</span>}
                </div>
                <div className="space-y-0.5 text-xs text-ink-500">
                  {game.release_year && <p>📅 {game.release_year}</p>}
                  {game.publisher    && <p>🏢 {game.publisher}</p>}
                  {game.age_rating   && <p>🔞 {game.age_rating}</p>}
                </div>
                <div className="flex gap-4 mt-3">
                  {game.igdb_rating != null && (
                    <div className="text-center">
                      <p className="text-base font-bold text-purple-600">{Math.round(Number(game.igdb_rating))}</p>
                      <p className="text-[10px] text-ink-400">IGDB</p>
                    </div>
                  )}
                  {game.rating_count != null && (
                    <div className="text-center">
                      <p className="text-base font-bold text-purple-400">{game.rating_count.toLocaleString()}</p>
                      <p className="text-[10px] text-ink-400">Votes</p>
                    </div>
                  )}
                  {game.rating != null && (
                    <div className="text-center">
                      <p className="text-base font-bold text-accent-600">★{game.rating}</p>
                      <p className="text-[10px] text-ink-400">My rating</p>
                    </div>
                  )}
                </div>
                {(game.platforms?.length ?? 0) > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {game.platforms!.map((p, i) => (
                      <span key={i} className="text-[10px] bg-ink-50 text-ink-600 border border-ink-200 px-1.5 py-0.5 rounded">{p}</span>
                    ))}
                  </div>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    onClick={handleQueueToggle}
                    className={`text-xs font-semibold px-3 py-1.5 min-h-[36px] rounded-lg transition-colors ${
                      game.play_order != null
                        ? 'bg-red-100 hover:bg-red-200 text-red-600'
                        : 'bg-orange-100 hover:bg-orange-200 text-orange-700'
                    }`}
                  >
                    {game.play_order != null ? `✕ Sıradan Çıkar (#${game.play_order})` : '🎮 Sıraya Ekle'}
                  </button>
                  <button
                    onClick={() => setPlanOpen(true)}
                    className="text-xs font-semibold px-3 py-1.5 min-h-[36px] rounded-lg bg-accent-100 hover:bg-accent-200 text-accent-700 transition-colors"
                  >
                    📅 Plan session
                  </button>
                </div>
              </div>
            </div>

            {/* Edit panel */}
            {editing && (
              <EditPanel
                gameId={game.id}
                initial={{ play_status: game.play_status, tier: game.tier, rating: game.rating, is_iconic: game.is_iconic, is_coop: game.is_coop, play_notes: game.play_notes }}
                onSave={handleSave}
                onCancel={() => setEditing(false)}
              />
            )}

            <div className="p-5 space-y-5">
              {(game.platforms_detail?.length ?? 0) > 0 && (
                <Section title="Platforms & Emulation">
                  <PlatformsTable platforms={game.platforms_detail!} />
                </Section>
              )}
              {game.description && (
                <Section title="About">
                  <p className="text-sm text-ink-700 leading-relaxed">{game.description}</p>
                </Section>
              )}
              {game.storyline && (
                <Section title="Storyline" defaultOpen={false}>
                  <p className="text-sm text-ink-600 leading-relaxed italic">{game.storyline}</p>
                </Section>
              )}
              {screenshots.length > 0 && (
                <Section title="Screenshots">
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {screenshots.map((url, i) => (
                      <button key={i} onClick={() => setLightboxIdx(i)}
                        className="flex-shrink-0 rounded-lg overflow-hidden border border-ink-200 hover:border-accent-400 transition-colors"
                        style={{ height: 80, width: 140 }}>
                        <img src={url} alt="" className="w-full h-full object-cover" />
                      </button>
                    ))}
                  </div>
                </Section>
              )}
              {((game.genres?.length ?? 0) > 0 || (game.themes?.length ?? 0) > 0 || (game.keywords?.length ?? 0) > 0) && (
                <Section title="Tags">
                  <div className="flex flex-wrap gap-1.5">
                    {game.genres?.map((g, i)   => <span key={i} className="text-xs bg-purple-50 text-purple-700 border border-purple-200 px-2 py-0.5 rounded-full">{String(g)}</span>)}
                    {game.themes?.map((t, i)   => <span key={i} className="text-xs bg-orange-50 text-orange-700 border border-orange-200 px-2 py-0.5 rounded-full">{String(t)}</span>)}
                    {game.keywords?.slice(0, 15).map((k, i) => <span key={i} className="text-xs bg-ink-50 text-ink-500 border border-ink-200 px-2 py-0.5 rounded-full">{String(k)}</span>)}
                  </div>
                </Section>
              )}
              {game.play_notes && (
                <Section title="My Notes">
                  <p className="text-sm text-ink-700 bg-cream-50 rounded-lg p-3 leading-relaxed whitespace-pre-line">{game.play_notes}</p>
                </Section>
              )}
              {game.game_log && (
                <Section title="Play Log" defaultOpen={false}>
                  <p className="text-sm text-ink-700 bg-cream-50 rounded-lg p-3 leading-relaxed whitespace-pre-line">{game.game_log}</p>
                </Section>
              )}
              {game.coop_notes && (
                <Section title="Co-op Notes">
                  <p className="text-sm text-ink-700 bg-cyan-50 rounded-lg p-3 leading-relaxed">{game.coop_notes}</p>
                </Section>
              )}
              {(game.multiplayer_info as unknown[])?.length > 0 && (
                <Section title="Multiplayer">
                  <div className="flex flex-wrap gap-2">
                    {(game.multiplayer_info as Record<string, unknown>[]).map((m, i) => (
                      <div key={i} className="text-xs bg-ink-50 border border-ink-200 rounded-lg px-3 py-2">
                        {Object.entries(m).filter(([, v]) => v != null && v !== false).map(([k, v]) => (
                          <div key={k}><span className="text-ink-400">{k}: </span><span className="text-ink-700">{String(v)}</span></div>
                        ))}
                      </div>
                    ))}
                  </div>
                </Section>
              )}
              {game.igdb_url && (
                <a href={game.igdb_url} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-purple-600 hover:text-purple-800 transition-colors">
                  🔗 View on IGDB
                </a>
              )}
            </div>
          </div>
        )}
      </DialogPanel>
      </div>

      {/* Lightbox */}
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
      <PlanModal
        open={planOpen}
        onClose={() => setPlanOpen(false)}
        defaultTitle={game.title}
        defaultCategory="games"
      />
    )}
  </>
  )
}
