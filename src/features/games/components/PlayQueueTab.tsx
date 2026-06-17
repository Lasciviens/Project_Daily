import { useState } from 'react'
import { usePlayQueue, useUpdateGame, useReorderQueue } from '../../home/hooks/useGames'
import { toast } from '../../../app/store'
import type { Game } from '../../home/api/gamesApi'

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
const TIER_BADGE: Record<string, string> = {
  S: 'bg-yellow-400 text-yellow-900', A: 'bg-orange-400 text-white',
  B: 'bg-green-500 text-white',       C: 'bg-blue-400 text-white',
  D: 'bg-ink-400 text-white',         F: 'bg-red-500 text-white',
}

type QueueGame = Game & { play_order: number | null }

function CoverImg({ url, title }: { url?: string | null; title: string }) {
  const [err, setErr] = useState(false)
  if (url && !err) return <img src={url} alt={title} onError={() => setErr(true)} className="w-full h-full object-cover" />
  return <div className="w-full h-full flex items-center justify-center bg-ink-100 text-base">🎮</div>
}

function QueueItem({
  game, index, total,
  onMoveUp, onMoveDown,
  onStatusChange,
}: {
  game: QueueGame
  index: number
  total: number
  onMoveUp: () => void
  onMoveDown: () => void
  onStatusChange: (status: string) => void
}) {
  return (
    <div className={`flex items-center gap-3 bg-white rounded-xl border border-ink-200 p-3 ${game.play_status === 'playing' ? 'ring-2 ring-orange-300' : ''}`}>
      {/* Position number */}
      <span className="text-xs font-bold text-ink-300 w-6 text-center flex-shrink-0">
        {game.play_status === 'playing' ? '▶' : index + 1}
      </span>

      {/* Cover */}
      <div className="flex-shrink-0 w-10 rounded-lg overflow-hidden border border-ink-100" style={{ aspectRatio: '3/4' }}>
        <CoverImg url={game.cover_url} title={game.title} />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-ink-800 truncate">{game.title}</p>
        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${STATUS_COLOR[game.play_status] ?? 'bg-ink-100'}`}>
            {STATUS_LABEL[game.play_status] ?? game.play_status}
          </span>
          {game.tier && (
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${TIER_BADGE[game.tier] ?? 'bg-ink-200'}`}>{game.tier}</span>
          )}
          {game.release_year && <span className="text-[10px] text-ink-400">{game.release_year}</span>}
          {game.is_iconic && <span className="text-xs">⭐</span>}
        </div>
      </div>

      {/* Quick actions */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {game.play_status !== 'playing' && (
          <button
            onClick={() => onStatusChange('playing')}
            className="text-[10px] font-semibold bg-orange-100 hover:bg-orange-200 text-orange-700 px-2 py-1 rounded-lg transition-colors min-h-[28px]"
          >▶ Play</button>
        )}
        {game.play_status === 'playing' && (
          <button
            onClick={() => onStatusChange('completed')}
            className="text-[10px] font-semibold bg-green-100 hover:bg-green-200 text-green-700 px-2 py-1 rounded-lg transition-colors min-h-[28px]"
          >✓ Done</button>
        )}
        {game.play_status === 'playing' && (
          <button
            onClick={() => onStatusChange('backlog')}
            className="text-[10px] font-semibold bg-ink-100 hover:bg-ink-200 text-ink-600 px-2 py-1 rounded-lg transition-colors min-h-[28px]"
          >⏸</button>
        )}
        <button
          onClick={() => onStatusChange('dropped')}
          className="text-[10px] text-red-400 hover:text-red-600 px-1.5 py-1 transition-colors min-h-[28px]"
        >✕</button>
      </div>

      {/* Reorder */}
      <div className="flex flex-col gap-0.5 flex-shrink-0">
        <button
          onClick={onMoveUp}
          disabled={index === 0}
          className="text-ink-300 hover:text-ink-600 disabled:opacity-20 text-xs leading-none p-0.5 transition-colors"
        >▲</button>
        <button
          onClick={onMoveDown}
          disabled={index === total - 1}
          className="text-ink-300 hover:text-ink-600 disabled:opacity-20 text-xs leading-none p-0.5 transition-colors"
        >▼</button>
      </div>
    </div>
  )
}

export function PlayQueueTab() {
  const { data: queue = [], isLoading, error } = usePlayQueue()
  const { mutate: updateGame }                 = useUpdateGame()
  const { mutate: reorder }                    = useReorderQueue()
  const [localOrder, setLocalOrder]            = useState<QueueGame[] | null>(null)

  // Use local order if user has reordered this session, otherwise use DB order
  const displayQueue: QueueGame[] = localOrder ?? (queue as QueueGame[])

  // Playing games always float to top visually
  const sorted = [
    ...displayQueue.filter(g => g.play_status === 'playing'),
    ...displayQueue.filter(g => g.play_status !== 'playing'),
  ]

  function move(index: number, direction: -1 | 1) {
    const arr   = [...sorted]
    const newIdx = index + direction
    if (newIdx < 0 || newIdx >= arr.length) return
    ;[arr[index], arr[newIdx]] = [arr[newIdx], arr[index]]
    setLocalOrder(arr)
    // Persist to DB
    const updates = arr.map((g, i) => ({ id: g.id, play_order: i + 1 }))
    reorder(updates)
  }

  function handleStatusChange(game: QueueGame, status: string) {
    const id = toast.loading('Updating…')
    updateGame(
      { id: game.id, patch: { play_status: status } },
      {
        onSuccess: () => { toast.dismiss(id); toast.success(`${STATUS_LABEL[status]} ✓`) },
        onError:   (e) => { toast.dismiss(id); toast.error((e as Error).message) },
      }
    )
    // Remove from local queue if completing or dropping
    if (status === 'completed' || status === 'dropped') {
      setLocalOrder(prev => (prev ?? sorted).filter(g => g.id !== game.id))
    } else {
      setLocalOrder(prev => (prev ?? sorted).map(g => g.id === game.id ? { ...g, play_status: status } : g))
    }
  }

  if (isLoading) return <div className="text-sm text-ink-400 py-12 text-center">Loading queue…</div>

  if (error) return (
    <div className="text-sm text-red-500 py-8 text-center">
      <p>Could not load queue.</p>
      <p className="text-xs text-red-400 mt-1">{(error as Error).message}</p>
      <p className="text-xs text-ink-400 mt-2">
        Make sure you've run the RP5 migration to add the <code>play_order</code> column.
      </p>
    </div>
  )

  if (sorted.length === 0) return (
    <div className="text-center py-16 text-ink-400">
      <p className="text-2xl mb-2">🎮</p>
      <p className="text-sm font-medium">Queue is empty</p>
      <p className="text-xs mt-1">Add games to your Playing, Backlog or Wishlist in the Library tab.</p>
    </div>
  )

  const playing  = sorted.filter(g => g.play_status === 'playing')
  const upcoming = sorted.filter(g => g.play_status !== 'playing')

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="flex gap-3">
        <div className="bg-orange-50 border border-orange-200 rounded-xl px-4 py-2.5 text-center">
          <p className="text-lg font-bold text-orange-600">{playing.length}</p>
          <p className="text-[10px] text-orange-500">Playing now</p>
        </div>
        <div className="bg-ink-50 border border-ink-200 rounded-xl px-4 py-2.5 text-center">
          <p className="text-lg font-bold text-ink-700">{upcoming.length}</p>
          <p className="text-[10px] text-ink-400">In queue</p>
        </div>
        <p className="text-xs text-ink-400 self-center ml-auto">Use ▲▼ to reorder. Changes save instantly.</p>
      </div>

      {/* Playing now */}
      {playing.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-orange-600 uppercase tracking-wide mb-2">▶ Playing Now</p>
          <div className="space-y-2">
            {playing.map((g, i) => (
              <QueueItem
                key={g.id} game={g} index={i} total={sorted.length}
                onMoveUp={()   => move(i, -1)}
                onMoveDown={()  => move(i,  1)}
                onStatusChange={s => handleStatusChange(g, s)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Up next */}
      {upcoming.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-ink-400 uppercase tracking-wide mb-2">Up Next</p>
          <div className="space-y-2">
            {upcoming.map((g, i) => (
              <QueueItem
                key={g.id} game={g}
                index={playing.length + i}
                total={sorted.length}
                onMoveUp={()  => move(playing.length + i, -1)}
                onMoveDown={() => move(playing.length + i,  1)}
                onStatusChange={s => handleStatusChange(g, s)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
