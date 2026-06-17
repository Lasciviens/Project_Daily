import { useState } from 'react'
import { useGameDetail } from '../../home/hooks/useGames'

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

// IGDB screenshots are stored as IDs → build URL
function igdbScreenshot(id: string, size = 'screenshot_med') {
  // If it looks like a full URL, use as-is
  if (id.startsWith('http')) return id
  return `https://images.igdb.com/igdb/image/upload/t_${size}/${id}.jpg`
}

interface Props {
  gameId: string
  onClose: () => void
}

export function GameDetailModal({ gameId, onClose }: Props) {
  const { data: game, isLoading } = useGameDetail(gameId)
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null)

  // Build screenshot list from IGDB + ScreenScraper
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
      <div
        className="fixed inset-0 bg-black/60 z-40 backdrop-blur-sm"
        onClick={onClose}
      />

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
            {/* Hero — cover + basic info */}
            <div className="flex gap-4 p-5 pb-4 border-b border-ink-100">
              {/* Cover */}
              <div className="flex-shrink-0 w-28 rounded-xl overflow-hidden border border-ink-200 bg-ink-100 self-start" style={{ aspectRatio: '3/4' }}>
                {game.cover_url ? (
                  <img src={game.cover_url} alt={game.title} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-3xl">🎮</div>
                )}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0 pt-1 pr-6">
                <h2 className="text-lg font-bold text-ink-900 leading-snug mb-1">{game.title}</h2>

                <div className="flex flex-wrap gap-1.5 mb-2">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLOR[game.play_status] ?? 'bg-ink-100 text-ink-500'}`}>
                    {STATUS_LABEL[game.play_status] ?? game.play_status}
                  </span>
                  {game.tier && (
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${TIER_COLOR[game.tier] ?? 'bg-ink-200'}`}>
                      {game.tier}
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
                <div className="flex gap-3 mt-3">
                  {game.igdb_rating != null && (
                    <div className="text-center">
                      <p className="text-base font-bold text-purple-600">{Math.round(Number(game.igdb_rating))}</p>
                      <p className="text-[10px] text-ink-400">IGDB</p>
                    </div>
                  )}
                  {game.rating != null && (
                    <div className="text-center">
                      <p className="text-base font-bold text-accent-600">{game.rating}</p>
                      <p className="text-[10px] text-ink-400">My rating</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="p-5 space-y-5">
              {/* Description */}
              {game.description && (
                <div>
                  <h3 className="text-xs font-semibold text-ink-400 uppercase tracking-wide mb-1.5">About</h3>
                  <p className="text-sm text-ink-700 leading-relaxed">{game.description}</p>
                </div>
              )}

              {/* Storyline */}
              {game.storyline && (
                <div>
                  <h3 className="text-xs font-semibold text-ink-400 uppercase tracking-wide mb-1.5">Storyline</h3>
                  <p className="text-sm text-ink-600 leading-relaxed italic">{game.storyline}</p>
                </div>
              )}

              {/* Screenshots */}
              {screenshots.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-ink-400 uppercase tracking-wide mb-1.5">Screenshots</h3>
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
                </div>
              )}

              {/* Keywords + Themes */}
              {((game.keywords?.length ?? 0) > 0 || (game.themes?.length ?? 0) > 0) && (
                <div>
                  <h3 className="text-xs font-semibold text-ink-400 uppercase tracking-wide mb-1.5">Tags</h3>
                  <div className="flex flex-wrap gap-1.5">
                    {game.themes?.map((t, i) => (
                      <span key={i} className="text-xs bg-orange-50 text-orange-700 border border-orange-200 px-2 py-0.5 rounded-full">{String(t)}</span>
                    ))}
                    {game.keywords?.slice(0, 15).map((k, i) => (
                      <span key={i} className="text-xs bg-ink-50 text-ink-500 border border-ink-200 px-2 py-0.5 rounded-full">{String(k)}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Personal notes */}
              {game.play_notes && (
                <div>
                  <h3 className="text-xs font-semibold text-ink-400 uppercase tracking-wide mb-1.5">My notes</h3>
                  <p className="text-sm text-ink-700 bg-cream-50 rounded-lg p-3 leading-relaxed">{game.play_notes}</p>
                </div>
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
          className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center"
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
