import {
  Home, CalendarDays, UtensilsCrossed, ShoppingBag, Clapperboard, Dumbbell, Star, Gamepad2,
  Briefcase, FolderKanban, Code2, type LucideIcon,
} from 'lucide-react'

// ─────────────────────────────────────────────────────────────────────────────
//  The ONE navigation registry (THEME.md §6.1). The sidebar, the top-bar and
//  phone-header titles, the phone tab bar, the More sheet and the command bar
//  all read this list. Adding a page = one entry here (plus its route).
//  Routes are stable; deep links never break when an entry moves group.
// ─────────────────────────────────────────────────────────────────────────────

export type NavGroupId = 'overview' | 'life' | 'play' | 'work' | 'system'

export interface NavEntry {
  id: string
  label: string
  path: string
  icon: LucideIcon
  group: NavGroupId
  /** Paths that light this entry up (default: its own path). */
  match?: string[]
  /** Phone bottom-bar slot (0-based). At most 5 entries carry one. */
  tab?: number
  /** Listed in the phone More sheet, in registry order. */
  more?: boolean
  /** A sub-page of another entry: routable and searchable, but no nav row of its own. */
  parent?: string
  /**
   * The page sizes itself against <main>'s height (a fixed two-pane layout
   * with its own scrolling panes). Everything else flows and scrolls in <main>.
   */
  fullHeight?: boolean
  /** Extra command-bar search terms. */
  keywords?: string[]
}

export const NAV_GROUPS: { id: NavGroupId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'life', label: 'Life' },
  { id: 'play', label: 'Media & play' },
  { id: 'work', label: 'Work' },
]

export const NAV: NavEntry[] = [
  { id: 'home', label: 'Home', path: '/home', icon: Home, group: 'overview', tab: 0, keywords: ['dashboard', 'briefing'] },
  { id: 'daily', label: 'Personal', path: '/daily', icon: CalendarDays, group: 'life', tab: 1, keywords: ['daily', 'today', 'tasks', 'schedule', 'agenda'] },
  { id: 'food', label: 'Food', path: '/recipes', icon: UtensilsCrossed, group: 'life', tab: 2, match: ['/recipes', '/shop'], keywords: ['recipes', 'nutrition', 'meals', 'diary'] },
  { id: 'shop', label: 'Shop', path: '/shop', icon: ShoppingBag, group: 'life', parent: 'food', fullHeight: true, keywords: ['wishlist', 'buy', 'shopping'] },
  { id: 'training', label: 'Training', path: '/training', icon: Dumbbell, group: 'life', tab: 4, keywords: ['hevy', 'workouts', 'health', 'strava'] },
  // Wishes leads the More sheet on purpose: a wish list that has to be hunted
  // for is dead in three weeks, and the 5 primary slots are taken.
  { id: 'wishes', label: 'Wishes', path: '/wishes', icon: Star, group: 'life', more: true, keywords: ['places', 'ideas', 'season'] },
  { id: 'media', label: 'Media', path: '/media', icon: Clapperboard, group: 'play', tab: 3, keywords: ['movies', 'tv', 'series', 'watch'] },
  { id: 'games', label: 'Games', path: '/games', icon: Gamepad2, group: 'play', more: true, keywords: ['library', 'steam', 'playstation', 'retro'] },
  { id: 'work', label: 'Work', path: '/work', icon: Briefcase, group: 'work', more: true, keywords: ['board', 'kanban'] },
  { id: 'projects', label: 'Projects', path: '/projects', icon: FolderKanban, group: 'work', more: true, keywords: ['phases'] },
  { id: 'developer', label: 'Developer', path: '/developer', icon: Code2, group: 'system', more: true, keywords: ['connections', 'activity', 'errors', 'memory'] },
]

const matches = (e: NavEntry, pathname: string) => (e.match ?? [e.path]).includes(pathname)

/** Entries that get a row of their own in the sidebar (sub-pages excluded). */
export const SIDEBAR_ENTRIES = NAV.filter(e => !e.parent)
export const TAB_ENTRIES = NAV.filter(e => e.tab != null).sort((a, b) => a.tab! - b.tab!)
export const MORE_ENTRIES = NAV.filter(e => e.more)

/** The entry whose row is active on this path (a sub-page lights its parent). */
export function activeEntry(pathname: string): NavEntry | undefined {
  return SIDEBAR_ENTRIES.find(e => matches(e, pathname))
}

export const isActive = (e: NavEntry, pathname: string) => matches(e, pathname)

/** Title for the shell header: the page's own label (Shop), else its entry's. */
export function routeTitle(pathname: string): string {
  return (NAV.find(e => e.path === pathname) ?? activeEntry(pathname))?.label ?? ''
}

export const isFullHeightRoute = (pathname: string) =>
  NAV.some(e => e.fullHeight && e.path === pathname)
