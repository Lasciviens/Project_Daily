// Developer's PageBoard layouts (THEME.md §6.3). Pure and import-free so
// scripts/verify-feature-boards.cjs can check them.
import type { BoardLayouts } from '../../shared/ui/pageBoardRules'

// ── Activity · Errors · Memory: list + detail pane ─────────────────────────
//   1  phone, tablet — the toolbar and the list; a row opens in place (or,
//      for Memory, in its edit sheet), as before.
//   2  1280 / 1469 laptop — toolbar + list in main (the toolbar only acts on
//      the list, so it stays its width), the picked row's detail in a sticky
//      pane beside them.
//   3  1920 and up — the pane spans two side tracks (a diff table and a
//      context dump need the room). It stops there: a detail pane wider
//      than 49rem is only longer lines.
export const LIST_DETAIL_SECTIONS = ['toolbar', 'list', 'detail'] as const
export type ListDetailSection = typeof LIST_DETAIL_SECTIONS[number]

export const LIST_DETAIL_BOARD: BoardLayouts<ListDetailSection> = {
  1: ['toolbar', 'list'],
  2: { columns: [['toolbar', 'list'], { stack: ['detail'], sticky: true }] },
  3: { columns: [['toolbar', 'list'], { stack: ['detail'], span: 2, sticky: true }] },
}

/** The first step with a detail pane; below it rows open in place. */
export const DETAIL_PANE_FROM = 2

/**
 * Which row the detail pane shows: the picked one while it is still in the
 * (filtered) list, else the first row, else nothing. So the pane is never
 * empty while there is something to show, and a filter that hides the
 * picked row falls back instead of showing a row that is no longer listed.
 */
export function paneSelection(ids: readonly string[], picked: string | null): string | null {
  if (picked != null && ids.includes(picked)) return picked
  return ids[0] ?? null
}

// ── Connections ────────────────────────────────────────────────────────────
// Six cards of two kinds: the three you sign in to from here (Google,
// Strava, PlayStation — the ones with controls) and three configured on the
// server (Steam, Hevy, Apple Health — read-only status). Both kinds are
// column STACKS under their own label at every width: the PlayStation card
// (with its npsso form, shown whenever the token is missing or expired —
// every month or two) is twice as tall as the others, and in a row of three
// it left a hole under Google and Strava.
//   1  phone, tablet — one list, as before.
//   2  laptop — your accounts in main, the server-side ones beside them.
//   3  1920 — your accounts in a 42rem main (the width the one-column list
//      gave a card before the board; a card is a line of text and a button),
//      the server-side cards two across over the other two tracks.
//   4  2450 — the same, the server-side cards three across in one row.
// Since Settings → Subscriptions (2026-09-29) this board lives there; 'intro'
// carries the subscription summary strip and 'otherSubs' (subscriptions for
// services without a card) ends the server-side column at every width.
export const CONNECTION_SECTIONS = [
  'intro', 'google', 'strava', 'psn', 'trakt', 'steam', 'hevy', 'health',
  'accountsLabel', 'serverLabel', 'serverCards', 'otherSubs',
] as const
export type ConnectionSection = typeof CONNECTION_SECTIONS[number]

const ACCOUNTS = ['accountsLabel', 'google', 'strava', 'psn', 'trakt'] as const
const SERVER = ['serverLabel', 'serverCards', 'otherSubs'] as const

export const CONNECTIONS_BOARD: BoardLayouts<ConnectionSection> = {
  1: ['intro', 'google', 'strava', 'psn', 'trakt', 'steam', 'hevy', 'health', 'otherSubs'],
  2: { top: ['intro'], columns: [ACCOUNTS, ['serverLabel', 'steam', 'hevy', 'health', 'otherSubs']] },
  3: { top: ['intro'], main: '42rem', columns: [ACCOUNTS, { stack: SERVER, span: 2 }] },
  4: { top: ['intro'], main: '42rem', columns: [ACCOUNTS, { stack: SERVER, span: 3 }] },
}
