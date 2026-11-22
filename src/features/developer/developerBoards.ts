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

// ── AI: the Claude layer's views (Developer → AI, `?view=`) ────────────────
// Four views under the page's bar, so the switcher fits a phone: Overview (what it cost) · Calls (every call) ·
// Settings (what the owner controls) · Learn (everything that explains it). Learn holds three more, in their own
// switcher under the bar (`?learn=`): How it works, Prices and the Test bench. A new explanation goes into Learn,
// never into a fifth tab. Every view has the list + detail tabs' tracks — two from the laptop, three from 1920, and
// it stops there — so the page's header keeps one width whichever tab or view is open (AI_VIEW_BOARDS →
// sectionsWidthRem). Calls is LIST_DETAIL_BOARD itself: the list, a call's detail in the pane.
export const AI_VIEWS = ['overview', 'calls', 'settings', 'learn'] as const
export type AiView = typeof AI_VIEWS[number]

export const AI_VIEW_LABEL: Record<AiView, string> = { overview: 'Overview', calls: 'Calls', settings: 'Settings', learn: 'Learn' }

export const AI_LEARN_VIEWS = ['how', 'prices', 'bench'] as const
export type AiLearnView = typeof AI_LEARN_VIEWS[number]

export const AI_LEARN_LABEL: Record<AiLearnView, string> = { how: 'How it works', prices: 'Prices', bench: 'Test bench' }

export interface AiLocation { view: AiView; learn: AiLearnView }

/**
 * Where an address points. `?view=` is one of the four; the older links `?view=how`, `?view=prices` and `?view=bench`
 * (before the views were grouped) still land on their page inside Learn. Anything else is the Overview.
 */
export function parseAiLocation(view: string | null | undefined, learn: string | null | undefined): AiLocation {
  const own = (AI_LEARN_VIEWS as readonly string[]).includes(learn ?? '') ? learn as AiLearnView : 'how'
  if ((AI_LEARN_VIEWS as readonly string[]).includes(view ?? '')) return { view: 'learn', learn: view as AiLearnView }
  return { view: (AI_VIEWS as readonly string[]).includes(view ?? '') ? view as AiView : 'overview', learn: own }
}

// Overview: the month against its budget and the chart per day in main; the
// numbers and the cost per job beside them (their own tracks from 1920).
export const AI_OVERVIEW_SECTIONS = ['budget', 'stats', 'jobs', 'chart'] as const
export type AiOverviewSection = typeof AI_OVERVIEW_SECTIONS[number]

export const AI_OVERVIEW_BOARD: BoardLayouts<AiOverviewSection> = {
  1: ['budget', 'stats', 'jobs', 'chart'],
  2: { columns: [['budget', 'chart'], ['stats', 'jobs']] },
  3: { columns: [['budget', 'chart'], ['stats'], ['jobs']] },
}

// Settings: the total budget and the text log first (a rail on the left from
// the laptop — they frame every job), the jobs in main, over the rest of the
// board from 1920 (a card per job, more across as the width grows).
export const AI_SETTINGS_SECTIONS = ['general', 'jobs'] as const
export type AiSettingsSection = typeof AI_SETTINGS_SECTIONS[number]

export const AI_SETTINGS_BOARD: BoardLayouts<AiSettingsSection> = {
  1: ['general', 'jobs'],
  2: { lead: 1, columns: [['general'], ['jobs']] },
  3: { lead: 1, columns: [['general'], { stack: ['jobs'], span: 2 }] },
}

// Prices: the table in main; the worked example and why it is read-only beside it.
export const AI_PRICES_SECTIONS = ['table', 'example', 'about'] as const
export type AiPricesSection = typeof AI_PRICES_SECTIONS[number]

export const AI_PRICES_BOARD: BoardLayouts<AiPricesSection> = {
  1: ['table', 'example', 'about'],
  2: { columns: [['table'], ['example', 'about']] },
  3: { columns: [['table'], ['example'], ['about']] },
}

// How it works: whether the key is set comes first on a phone, then the path of one request and, right under it,
// the check of the connection (Diagnose is for when that path misbehaves, so it follows the path); what is still on
// Gemini comes before the jobs. From the laptop the path, Diagnose and the jobs (the long reads) keep main, with
// the key, Gemini's leftovers, the parts, the fixed rules and the glossary beside them.
export const AI_HOW_SECTIONS = ['status', 'steps', 'diagnose', 'gemini', 'jobs', 'parts', 'rules', 'glossary'] as const
export type AiHowSection = typeof AI_HOW_SECTIONS[number]

export const AI_HOW_BOARD: BoardLayouts<AiHowSection> = {
  1: ['status', 'steps', 'diagnose', 'gemini', 'jobs', 'parts', 'rules', 'glossary'],
  2: { columns: [['steps', 'diagnose', 'jobs'], ['status', 'gemini', 'parts', 'rules', 'glossary']] },
  3: { columns: [['steps', 'diagnose', 'jobs'], ['status', 'gemini', 'parts'], ['rules', 'glossary']] },
}

// Test bench: the question and its pick first, the answer beside it from the laptop (their own tracks from 1920).
export const AI_BENCH_SECTIONS = ['ask', 'answer'] as const
export type AiBenchSection = typeof AI_BENCH_SECTIONS[number]

export const AI_BENCH_BOARD: BoardLayouts<AiBenchSection> = {
  1: ['ask', 'answer'],
  2: { columns: [['ask'], ['answer']] },
  3: { columns: [['ask'], ['answer']] },
}

/** Every board the AI tab lays out, for the page header's one width. */
export const AI_VIEW_BOARDS: ReadonlyArray<BoardLayouts<string>> = [AI_OVERVIEW_BOARD, LIST_DETAIL_BOARD, AI_SETTINGS_BOARD, AI_PRICES_BOARD, AI_HOW_BOARD, AI_BENCH_BOARD]

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
// Anthropic (20.11.2026, the Claude layer) is the last server-side card: its
// key is a server secret, so it only says whether the key is set.
export const CONNECTION_SECTIONS = [
  'intro', 'google', 'icloud', 'strava', 'psn', 'trakt', 'steam', 'igdb', 'hevy', 'health', 'kobo', 'anthropic',
  'accountsLabel', 'serverLabel', 'serverCards', 'otherSubs',
] as const
export type ConnectionSection = typeof CONNECTION_SECTIONS[number]

const ACCOUNTS = ['accountsLabel', 'google', 'icloud', 'strava', 'psn', 'trakt'] as const
const SERVER = ['serverLabel', 'serverCards', 'otherSubs'] as const

export const CONNECTIONS_BOARD: BoardLayouts<ConnectionSection> = {
  1: ['intro', 'google', 'icloud', 'strava', 'psn', 'trakt', 'steam', 'igdb', 'hevy', 'health', 'kobo', 'anthropic', 'otherSubs'],
  2: { top: ['intro'], columns: [ACCOUNTS, ['serverLabel', 'steam', 'igdb', 'hevy', 'health', 'kobo', 'anthropic', 'otherSubs']] },
  3: { top: ['intro'], main: '42rem', columns: [ACCOUNTS, { stack: SERVER, span: 2 }] },
  4: { top: ['intro'], main: '42rem', columns: [ACCOUNTS, { stack: SERVER, span: 3 }] },
}
