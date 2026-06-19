import { useState, useRef } from 'react'
import { usePlayQueue, useUpdateGame, useReorderQueue, useRemoveFromQueue } from '../../home/hooks/useGames'
import { toast } from '../../../app/store'
import type { QueueGame } from '../../home/api/gamesApi'

const STATUS_COLOR: Record<string, string> = {
  playing:   'bg-orange-100 text-orange-700 border-orange-200',
  completed: 'bg-green-100 text-green-700 border-green-200',
  wishlist:  'bg-purple-100 text-purple-700 border-purple-200',
  backlog:   'bg-ink-100 text-ink-500 border-ink-200',
  dropped:   'bg-red-100 text-red-600 border-red-200',
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

function CoverImg({ url, title }: { url?: string | null; title: string }) {
  const [err, setErr] = useState(false)
  if (url && !err) return (
    <img src={url} alt={title} onError={() => setErr(true)} className="w-full h-full object-cover" />
  )
  return <div className="w-full h-full flex items-center justify-center bg-ink-100 text-lg">🎮</div>
}

export function PlayQueueTab() {
  const { data: queue = [], isLoading, error } = usePlayQueue()
  const { mutate: updateGame }                 = useUpdateGame()
  const { mutate: reorder }                    = useReorderQueue()
  const { mutate: removeFromQueue }            = useRemoveFromQueue()

  // Local copy for instant drag-and-drop feedback
  const [items, setItems]       = useState<QueueGame[] | null>(null)
  const dragIdx                 = useRef<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)

  const displayItems: QueueGame[] = items ?? (queue as QueueGame[])
  const playing  = displayItems.filter(g => g.play_status === 'playing')
  const upcoming = displayItems.filter(g => g.play_status !== 'playing')

  // ── Drag & drop ──────────────────────────────────────────────────────────

  function onDragStart(idx: number) {
    dragIdx.current = idx
  }

  function onDragOver(e: React.DragEvent, idx: number) {
    e.preventDefault()
    setDragOver(idx)
  }

  function onDrop(targetIdx: number) {
    const src = dragIdx.current
    if (src === null || src === targetIdx) { setDragOver(null); return }
    const arr = [...displayItems]
    const [item] = arr.splice(src, 1)
    arr.splice(targetIdx, 0, item)
    setItems(arr)
    setDragOver(null)
    dragIdx.current = null
    reorder(arr.map((g, i) => ({ id: g.id, play_order: i + 1 })))
  }

  function onDragEnd() {
    setDragOver(null)
    dragIdx.current = null
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  function handleMarkPlaying(game: QueueGame) {
    const id = toast.loading('Marking as playing…')
    updateGame(
      { id: game.id, patch: { play_status: 'playing' } },
      {
        onSuccess: () => {
          toast.dismiss(id); toast.success('▶ Playing ✓')
          setItems(prev => (prev ?? displayItems).map(g => g.id === game.id ? { ...g, play_status: 'playing' } : g))
        },
        onError: (e) => { toast.dismiss(id); toast.error((e as Error).message) },
      }
    )
  }

  function handleRemove(game: QueueGame) {
    const id = toast.loading('Removing from queue…')
    removeFromQueue(game.id, {
      onSuccess: () => {
        toast.dismiss(id); toast.success('Removed from queue')
        setItems(prev => (prev ?? displayItems).filter(g => g.id !== game.id))
      },
      onError: (e) => { toast.dismiss(id); toast.error((e as Error).message) },
    })
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (isLoading) return <div className="text-sm text-ink-400 py-12 text-center">Loading queue…</div>

  if (error) return (
    <div className="text-center py-10 space-y-2">
      <p className="text-sm text-red-500">Could not load queue.</p>
      <p className="text-xs text-red-400">{(error as Error).message}</p>
      <p className="text-xs text-ink-400 mt-2">
        Make sure you've run <code className="bg-ink-100 px-1 rounded">supabase/rp5-migrations/001_play_order.sql</code> in the RP5 Supabase SQL Editor.
      </p>
    </div>
  )

  if (displayItems.length === 0) return (
    <div className="text-center py-16 text-ink-400">
      <p className="text-3xl mb-3">🎮</p>
      <p className="text-sm font-medium text-ink-700">Queue is empty</p>
      <p className="text-xs mt-1">Open a game's detail modal and click <strong>🎮 Sıraya Ekle</strong> to add it.</p>
    </div>
  )

  function QueueItem({ game, globalIdx }: { game: QueueGame; globalIdx: number }) {
    const isPlaying   = game.play_status === 'playing'
    const isDragOver  = dragOver === globalIdx
    return (
      <div
        draggable
        onDragStart={() => onDragStart(globalIdx)}
        onDragOver={e  => onDragOver(e, globalIdx)}
        onDrop={()     => onDrop(globalIdx)}
        onDragEnd={onDragEnd}
        className={`flex items-center gap-3 bg-white rounded-xl border transition-all cursor-grab active:cursor-grabbing select-none
          ${isPlaying    ? 'border-orange-300 ring-1 ring-orange-200' : 'border-ink-200'}
          ${isDragOver   ? 'border-accent-400 bg-accent-50 scale-[1.01]' : ''}
        `}
      >
        {/* Drag handle + position */}
        <div className="flex-shrink-0 w-10 flex flex-col items-center justify-center py-3 gap-1 text-ink-300">
          <span className="text-base leading-none select-none">⠿</span>
          <span className={`text-[10px] font-black w-5 h-5 rounded-full flex items-center justify-center
            ${isPlaying
              ? 'bg-orange-500 text-white'
              : 'bg-gradient-to-br from-accent-400 to-accent-600 text-white'
            }`}>
            {isPlaying ? '▶' : globalIdx + 1}
          </span>
        </div>

        {/* Cover */}
        <div className="flex-shrink-0 rounded-lg overflow-hidden border border-ink-100 bg-ink-100" style={{ width: 40, height: 55 }}>
          <CoverImg url={game.cover_url} title={game.title} />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0 py-2 overflow-hidden">
          <p className="text-sm font-semibold text-ink-800 truncate leading-snug">{game.title}</p>
          <div className="flex items-center gap-1 mt-1 flex-nowrap overflow-hidden">
            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full border flex-shrink-0 ${STATUS_COLOR[game.play_status] ?? 'bg-ink-100 text-ink-500'}`}>
              {STATUS_LABEL[game.play_status] ?? game.play_status}
            </span>
            {game.tier && (
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 ${TIER_BADGE[game.tier] ?? 'bg-ink-200'}`}>{game.tier}</span>
            )}
            {game.platforms?.slice(0, 1).map((p, i) => (
              <span key={i} className="text-[10px] bg-ink-50 text-ink-500 border border-ink-200 px-1.5 py-0.5 rounded truncate min-w-0">{p}</span>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex-shrink-0 flex items-center gap-1 pr-3">
          {!isPlaying && (
            <button
              onClick={() => handleMarkPlaying(game)}
              className="w-11 h-11 flex items-center justify-center rounded-lg bg-orange-100 hover:bg-orange-200 text-orange-600 transition-colors text-sm"
              title="Mark as playing"
            >▶</button>
          )}
          <button
            onClick={() => handleRemove(game)}
            className="w-11 h-11 flex items-center justify-center rounded-lg bg-ink-100 hover:bg-red-100 text-ink-400 hover:text-red-500 transition-colors text-sm"
            title="Remove from queue"
          >✕</button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="flex gap-2 flex-wrap">
        {[
          { label: 'In Queue', value: displayItems.length,                 color: 'text-ink-800'    },
          { label: 'Playing',  value: playing.length,                      color: 'text-orange-600' },
          { label: 'Upcoming', value: upcoming.length,                     color: 'text-accent-600' },
        ].map(s => (
          <div key={s.label} className="bg-white border border-ink-200 rounded-xl px-4 py-2.5 text-center">
            <p className={`text-lg font-bold ${s.color}`}>{s.value}</p>
            <p className="text-[10px] text-ink-400">{s.label}</p>
          </div>
        ))}
        <p className="text-xs text-ink-400 self-center ml-auto">Drag ⠿ to reorder</p>
      </div>

      {/* Playing now */}
      {playing.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-orange-600 uppercase tracking-wide mb-2">▶ Now Playing</p>
          <div className="space-y-2">
            {playing.map((g, i) => <QueueItem key={g.id} game={g} globalIdx={i} />)}
          </div>
        </div>
      )}

      {/* Up next */}
      {upcoming.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-ink-400 uppercase tracking-wide mb-2">Up Next</p>
          <div className="space-y-2">
            {upcoming.map((g, i) => <QueueItem key={g.id} game={g} globalIdx={playing.length + i} />)}
          </div>
        </div>
      )}
    </div>
  )
}
