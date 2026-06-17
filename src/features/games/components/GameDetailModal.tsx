import { useState } from 'react'
import { useGameDetail } from '../../home/hooks/useGames'
import type { PlatformDetail } from '../../home/api/gamesApi'

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

// Performance labels → color badge
const PERF_COLOR: Record<string, string> = {
  great:       'bg-green-100 text-green-700 border-green-200',
  perfect:     'bg-green-100 text-green-700 border-green-200',
  good:        'bg-teal-100 text-teal-700 border-teal-200',
  playable:    'bg-yellow-100 text-yellow-700 border-yellow-200',
  ok:          'bg-yellow-100 text-yellow-700 border-yellow-200',
  bad:         'bg-orange-100 text-orange-700 border-orange-200',
  poor:        'bg-orange-100 text-orange-700 border-orange-200',
  unplayable:  'bg-red-100 text-red-600 border-red-200',
  runs:        'bg-teal-100 text-teal-700 border-teal-200',
}

function perfBadgeClass(perf?: string): string {
  if (!perf) return 'bg-ink-100 text-ink-500 border-ink-200'
  return PERF_COLOR[perf.toLowerCase()] ?? 'bg-ink-100 text-ink-500 border-ink-200'
}

// ROM status pill
const ROM_COLOR: Record<string, string> = {
  owned:    'bg-green-100 text-green-700',
  digital:  'bg-blue-100 text-blue-700',
  missing:  'bg-red-100 text-red-600',
  patched:  'bg-purple-100 text-purple-700',
}

function igdbScreenshot(id: string, size = 'screenshot_med') {
  if (id.startsWith('http')) return id
  return `https://images.igdb.com/igdb/image/upload/t_${size}/${id}.jpg`
}

// Collapsible section helper
function Section({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div>
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between text-xs font-semibold text-ink-400 uppercase tracking-wide mb-1.5 hover:text-ink-600 transition-colors"
      >
        {title}
        <span className="text-ink-300">{open ? '▲' : '▼'}</span>
      </button>
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
                {p.system ?? '—'}
                {p.is_preferred && <span className="ml-1 text-[9px] text-green-600">★</span>}
                {p.version_title && <p className="text-[10px] text-ink-400 font-normal">{p.version_title}</p>}
              </td>
              <td className="py-1.5 pr-3 text-ink-600">{p.emulator ?? '—'}</td>
              <td className="py-1.5 pr-3">
                {p.performance ? (
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${perfBadgeClass(p.performance)}`}>
                    {p.performance}
                  </span>
                ) : '—'}
                {p.performance_notes && (
                  <p className="text-[10px] text-ink-400 mt-0.5">{p.performance_notes}</p>
                )}
              </td>
              <td className="py-1.5 pr-3">
                {p.rom_status ? (
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${ROM_COLOR[p.rom_status.toLowerCase()] ?? 'bg-ink-100 text-ink-500'}`}>
                    {p.rom_status}
                  </span>
                ) : '—'}
              </td>
              <td className="py-1.5 text-ink-500">{p.region ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

interface Props {
  gameId: string
  onClose: () => void
}

export function GameDetailModal({ gameId, onClose }: Props) {
  const { data: game, isLoading } = useGameDetail(gameId)
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null)

  const screenshots: string[] = []
  if (game?.screenshots?.length) {
    screenshots.push(...game.screenshots.map(s => igdbScreenshot(s)))
  }
  if (game?.ss_screenshot_url) screenshots.push(game.ss_screenshot_url)
  if (game?.ss_fanart_url)     screenshots.push(game.ss_fanart_url)

  function prevScreenshot() {
    if (lightboxIdx === null) return
    setLightboxIdx((lightboxIdx - 1 + screenshots.length) % screenshots.length)
  }
  function nextScreenshot() {
    if (lightboxIdx === null) return
    setLightboxIdx((lightboxIdx + 1) % screenshots.length)
  }

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/60 z-40 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="fixed inset-x-4 top-4 bottom-4 md:inset-x-auto md:left-1/2 md:-translate-x-1/2 md:w-full md:max-w-2xl z-50 overflow-y-auto bg-white rounded-2xl shadow-2xl">
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-10 w-8 h-8 flex items-center justify-center bg-ink-100 hover:bg-ink-200 rounded-full text-ink-500 transition-colors"
        >✕</button>

        {isLoading && (
          <div className="flex items-center justify-center h-48 text-ink-400">Loading…</div>
        )}

        {game && (
          <div>
            {/* Hero */}
            <div className="flex gap-4 p-5 pb-4 border-b border-ink-100">
              <div className="flex-shrink-0 w-28 rounded-xl overflow-hidden border border-ink-200 bg-ink-100 self-start" style={{ aspectRatio: '3/4' }}>
                {game.cover_url ? (
                  <img src={game.cover_url} alt={game.title} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-3xl bg-ink-100">🎮</div>
                )}
              </div>

              <div className="flex-1 min-w-0 pt-1 pr-6">
                <h2 className="text-lg font-bold text-ink-900 leading-snug mb-0.5">{game.title}</h2>
                {game.series_name && (
                  <p className="text-xs text-ink-400 mb-1.5">⛓ {game.series_name}</p>
                )}

                <div className="flex flex-wrap gap-1.5 mb-2">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLOR[game.play_status] ?? 'bg-ink-100 text-ink-500'}`}>
                    {STATUS_LABEL[game.play_status] ?? game.play_status}
                  </span>
                  {game.tier && (
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${TIER_COLOR[game.tier] ?? 'bg-ink-200'}`}>
                      Tier {game.tier}
                    </span>
                  )}
                  {game.is_iconic && <span className="text-sm">⭐</span>}
                  {game.is_coop  && (
                    <span className="text-xs font-bold bg-cyan-500 text-white px-2 py-0.5 rounded-full">2P</span>
                  )}
                </div>

                <div className="space-y-0.5 text-xs text-ink-500">
                  {game.release_year && <p>📅 {game.release_year}</p>}
                  {game.publisher    && <p>🏢 {game.publisher}</p>}
                  {game.age_rating   && <p>🔞 {game.age_rating}</p>}
                </div>

                {/* Ratings */}
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

                {/* Platform chips */}
                {(game.platforms?.length ?? 0) > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {game.platforms!.map((p, i) => (
                      <span key={i} className="text-[10px] bg-ink-50 text-ink-600 border border-ink-200 px-1.5 py-0.5 rounded">{p}</span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="p-5 space-y-5">

              {/* Platforms detail table */}
              {(game.platforms_detail?.length ?? 0) > 0 && (
                <Section title="Platforms & Emulation">
                  <PlatformsTable platforms={game.platforms_detail!} />
                </Section>
              )}

              {/* Description */}
              {game.description && (
                <Section title="About">
                  <p className="text-sm text-ink-700 leading-relaxed">{game.description}</p>
                </Section>
              )}

              {/* Storyline */}
              {game.storyline && (
                <Section title="Storyline" defaultOpen={false}>
                  <p className="text-sm text-ink-600 leading-relaxed italic">{game.storyline}</p>
                </Section>
              )}

              {/* Screenshots */}
              {screenshots.length > 0 && (
                <Section title="Screenshots">
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {screenshots.map((url, i) => (
                      <button
                        key={i}
                        onClick={() => setLightboxIdx(i)}
                        className="flex-shrink-0 rounded-lg overflow-hidden border border-ink-200 hover:border-accent-400 transition-colors"
                        style={{ height: 80, width: 140 }}
                      >
                        <img src={url} alt="" className="w-full h-full object-cover" />
                      </button>
                    ))}
                  </div>
                </Section>
              )}

              {/* Genres + Themes + Keywords */}
              {((game.genres?.length ?? 0) > 0 || (game.themes?.length ?? 0) > 0 || (game.keywords?.length ?? 0) > 0) && (
                <Section title="Tags">
                  <div className="flex flex-wrap gap-1.5">
                    {game.genres?.map((g, i) => (
                      <span key={i} className="text-xs bg-purple-50 text-purple-700 border border-purple-200 px-2 py-0.5 rounded-full">{String(g)}</span>
                    ))}
                    {game.themes?.map((t, i) => (
                      <span key={i} className="text-xs bg-orange-50 text-orange-700 border border-orange-200 px-2 py-0.5 rounded-full">{String(t)}</span>
                    ))}
                    {game.keywords?.slice(0, 15).map((k, i) => (
                      <span key={i} className="text-xs bg-ink-50 text-ink-500 border border-ink-200 px-2 py-0.5 rounded-full">{String(k)}</span>
                    ))}
                  </div>
                </Section>
              )}

              {/* Personal notes */}
              {game.play_notes && (
                <Section title="My Notes">
                  <p className="text-sm text-ink-700 bg-cream-50 rounded-lg p-3 leading-relaxed whitespace-pre-line">{game.play_notes}</p>
                </Section>
              )}

              {/* Play log */}
              {game.game_log && (
                <Section title="Play Log" defaultOpen={false}>
                  <p className="text-sm text-ink-700 bg-cream-50 rounded-lg p-3 leading-relaxed whitespace-pre-line">{game.game_log}</p>
                </Section>
              )}

              {/* Co-op notes */}
              {game.coop_notes && (
                <Section title="Co-op Notes">
                  <p className="text-sm text-ink-700 bg-cyan-50 rounded-lg p-3 leading-relaxed">{game.coop_notes}</p>
                </Section>
              )}

              {/* Multiplayer info */}
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

              {/* IGDB link */}
              {game.igdb_url && (
                <a
                  href={game.igdb_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-purple-600 hover:text-purple-800 transition-colors"
                >
                  🔗 View on IGDB
                </a>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Lightbox */}
      {lightboxIdx !== null && screenshots[lightboxIdx] && (
        <div
          className="fixed inset-0 bg-black/90 z-[60] flex items-center justify-center"
          onClick={() => setLightboxIdx(null)}
        >
          <button
            onClick={e => { e.stopPropagation(); prevScreenshot() }}
            className="absolute left-4 text-white text-2xl bg-black/40 hover:bg-black/60 w-10 h-10 rounded-full flex items-center justify-center"
          >‹</button>
          <img
            src={screenshots[lightboxIdx]}
            alt=""
            className="max-w-full max-h-full object-contain rounded-lg"
            onClick={e => e.stopPropagation()}
          />
          <button
            onClick={e => { e.stopPropagation(); nextScreenshot() }}
            className="absolute right-4 text-white text-2xl bg-black/40 hover:bg-black/60 w-10 h-10 rounded-full flex items-center justify-center"
          >›</button>
          <button
            onClick={() => setLightboxIdx(null)}
            className="absolute top-4 right-4 text-white text-xl bg-black/40 hover:bg-black/60 w-8 h-8 rounded-full flex items-center justify-center"
          >✕</button>
          <span className="absolute bottom-4 text-white/60 text-xs">{lightboxIdx + 1} / {screenshots.length}</span>
        </div>
      )}
    </>
  )
}
