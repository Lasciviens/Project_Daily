// Shared status/tier label + color maps for Games views (GamesPage,
// PlayQueueTab, GameDetailModal, TierEditorTab) — was independently forked
// (sometimes under a different const name) in all 4.

export const STATUS_LABEL: Record<string, string> = {
  playing: 'Playing', completed: 'Completed', wishlist: 'Wishlist',
  backlog: 'Backlog', dropped: 'Dropped',
}

export const STATUS_COLOR: Record<string, string> = {
  playing:   'bg-orange-100 text-orange-700',
  completed: 'bg-green-100 text-green-700',
  wishlist:  'bg-purple-100 text-purple-700',
  backlog:   'bg-ink-100 text-ink-500',
  dropped:   'bg-red-100 text-red-600',
}

export const STATUS_BORDER: Record<string, string> = {
  playing:   'border-l-orange-400',
  completed: 'border-l-green-500',
  wishlist:  'border-l-purple-500',
  backlog:   'border-l-ink-300',
  dropped:   'border-l-red-400',
}

export const TIER_COLOR: Record<string, string> = {
  S: 'bg-yellow-400 text-yellow-900', A: 'bg-orange-400 text-white',
  B: 'bg-green-500 text-white',       C: 'bg-blue-400 text-white',
  D: 'bg-ink-400 text-white',         F: 'bg-red-500 text-white',
}

export const TIERS    = ['S', 'A', 'B', 'C', 'D', 'F']
export const STATUSES = ['playing', 'wishlist', 'backlog', 'completed', 'dropped']
