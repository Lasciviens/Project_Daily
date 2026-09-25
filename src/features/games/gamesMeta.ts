// Shared status label + color maps for Games views (GamesPage,
// PlayQueueTab, GameDetailModal) — was independently forked
// (sometimes under a different const name) in all 4.

export const STATUS_LABEL: Record<string, string> = {
  playing: 'Playing', completed: 'Completed', wishlist: 'Wishlist',
  backlog: 'Backlog', dropped: 'Dropped', hidden: 'Hidden',
}

export const STATUS_COLOR: Record<string, string> = {
  playing:   'bg-orange-100 text-orange-700',
  completed: 'bg-green-100 text-green-700',
  wishlist:  'bg-purple-100 text-purple-700',
  backlog:   'bg-ink-100 text-ink-500',
  dropped:   'bg-red-100 text-red-600',
  hidden:    'bg-ink-200 text-ink-500',
}

export const STATUS_BORDER: Record<string, string> = {
  playing:   'border-l-orange-400',
  completed: 'border-l-green-500',
  wishlist:  'border-l-purple-500',
  backlog:   'border-l-ink-300',
  dropped:   'border-l-red-400',
}

// The status PICKER. 'hidden' is deliberately absent: it is set by its own
// checkbox (LibraryControls), because offering it as a sixth pill would read
// as a kind of progress rather than "keep this out of the grid".
export const STATUSES = ['playing', 'wishlist', 'backlog', 'completed', 'dropped']

// Was independently forked in GameDetailModal (perfBadgeClass) and referenced
// nowhere else consistently — one map now.
export const PERFORMANCE_COLOR: Record<string, string> = {
  good: 'bg-teal-100 text-teal-700 border-teal-200',
  warn: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  bad:  'bg-red-100 text-red-600 border-red-200',
}

export const ROM_STATUS_COLOR: Record<string, string> = {
  missing:   'bg-red-100 text-red-600',
  found:     'bg-blue-100 text-blue-700',
  verified:  'bg-teal-100 text-teal-700',
  installed: 'bg-green-100 text-green-700',
  sd_card:   'bg-purple-100 text-purple-700',
}

export const EXTERNAL_SOURCE_LABEL: Record<string, string> = {
  screenscraper: 'ScreenScraper',
  esde:          'EmulationStation-DE',
  manual:        'Manually added',
}
