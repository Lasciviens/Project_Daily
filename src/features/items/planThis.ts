// THE one place a Plan button's request is built (Phase 3 A2, owner 26.11.2026): the item screen's defaults and the
// task's link for every kind of thing. Every Plan button calls `usePlanThis()` with the thing's facts — never a
// `{ kind: 'task' | 'time-block', defaults, source }` of its own (verify-plan-this checks it).
import type { EntityModalRequest } from '../../shared/modals'
import { ceilToQuarter } from '../../shared/components/plan-modal/planModal.config'
import { matchItem, MATCH_CATEGORY, MATCH_TIME_ZONE, type FbMatch } from '../football/footballModel'
import { planDefaults } from '../shop/shopModel'
import type { ItemLink, ItemLinkKind } from './itemTypes'
import { episodeCode } from './linkKinds'

export interface PlanEpisode { number: number; name: string; runtime?: number | null }

/** The facts each kind's Plan button has. A movie or show without an id (a Queue title not in the library) plans
 *  without a link. */
export type PlanThing =
  | { kind: 'movie'; id?: string | null; title: string; runtimeMinutes?: number | null; /** "Cinema trip": title "Cinema: X". */ cinema?: boolean }
  | { kind: 'tv'; id?: string | null; show: string; season?: number; episodes?: readonly PlanEpisode[]; runtimeMinutes?: number | null; date?: string }
  | { kind: 'game'; id: string; title: string; date?: string }
  | { kind: 'shop_item'; id: string; title: string; plannedDate?: string | null; notes?: string | null;
      /** buy (a wish), or a date of a thing you own: return by, complain by, or the handover of a sale. */
      purpose?: ShopPlanPurpose; due?: string | null }
  | { kind: 'wish'; id: string; title: string }
  | { kind: 'football'; match: FbMatch }
  | { kind: 'training'; routine?: { id: string; title: string } | null; date?: string; onSaved?: () => void }

export type ShopPlanPurpose = 'buy' | 'return' | 'complain' | 'handover'

const SHOP_TITLE: Record<Exclude<ShopPlanPurpose, 'buy'>, string> = { return: 'Return', complain: 'Complain about', handover: 'Hand over' }

type PlanRequest = Extract<EntityModalRequest, { kind: 'task' | 'time-block' }>

/** The thing whose open plan "Plan" opens instead of a second one; null when several open plans are normal (a batch
 *  of episodes, a routine's weekly sessions) or there is no thing (a title not in the library). */
export function planLookup(thing: PlanThing): { kind: ItemLinkKind; id: string; season?: number; episode?: number } | null {
  switch (thing.kind) {
    case 'movie': return thing.id ? { kind: 'movie', id: thing.id } : null
    case 'tv': return thing.id && thing.season != null && thing.episodes?.length === 1
      ? { kind: 'tv', id: thing.id, season: thing.season, episode: thing.episodes[0].number } : null
    case 'game': case 'shop_item': case 'wish': return { kind: thing.kind, id: thing.id }
    case 'football': case 'training': return null
  }
}

/** The item screen request for a new plan of this thing, with its link (saved with the item in one transaction). */
export function planRequest(thing: PlanThing, today: string): PlanRequest {
  switch (thing.kind) {
    case 'movie': {
      const link: ItemLink | undefined = thing.id ? { kind: 'movie', id: thing.id } : undefined
      return {
        kind: 'time-block',
        defaults: { title: `${thing.cinema ? 'Cinema' : 'Watch'}: ${thing.title}`, duration: ceilToQuarter(thing.runtimeMinutes || 120), category: 'media', color: 'purple', ...(thing.cinema ? { mediaType: 'cinema' as const } : {}) },
        ...(link ? { source: { sourceType: 'movie', sourceId: thing.id ?? undefined, taskSourceType: 'movie', link } } : {}),
      }
    }
    case 'tv': {
      const eps = thing.episodes ?? []
      const runtime = thing.runtimeMinutes ?? 45
      const season = thing.season ?? null
      const one = eps.length === 1 && season != null ? eps[0] : null
      const title = one && season != null
        ? `📺 ${thing.show} · ${episodeCode(season, one.number)} "${one.name}"`
        : eps.length > 1 && season != null ? `📺 ${thing.show} · S${String(season).padStart(2, '0')} (${eps.length} ep)` : `📺 ${thing.show}`
      // Real runtimes summed, rounded UP to the next quarter (44 → 45, 91 → 105).
      const duration = ceilToQuarter(eps.reduce((sum, e) => sum + (e.runtime ?? runtime), 0) || (eps.length ? runtime : thing.runtimeMinutes ?? 60))
      const link: ItemLink | undefined = thing.id
        ? (one && season != null ? { kind: 'tv', id: thing.id, season, episode: one.number } : { kind: 'tv', id: thing.id })
        : undefined
      return {
        kind: 'time-block',
        defaults: { title, date: thing.date ?? today, duration, category: 'media', color: 'blue' },
        ...(thing.id ? {
          source: {
            sourceType: 'tv_episode', sourceId: thing.id, taskSourceType: 'tv_series', link,
            // Only one specific episode is matched when it is watched; a batch is left alone (043).
            episodeInfo: one && season != null ? { seasonNumber: season, episodeNumber: one.number } : undefined,
          },
        } : {}),
      }
    }
    case 'game':
      return {
        kind: 'time-block',
        defaults: { title: `🎮 ${thing.title}`, duration: 60, category: 'games', color: 'purple', ...(thing.date ? { date: thing.date } : {}) },
        source: { link: { kind: 'game', id: thing.id } },
      }
    case 'shop_item': {
      const purpose = thing.purpose ?? 'buy'
      const defaults = purpose === 'buy'
        ? planDefaults({ title: thing.title, planned_date: thing.plannedDate ?? null, notes: thing.notes ?? null })
        : { title: `${SHOP_TITLE[purpose]} ${thing.title.trim()}`, ...(thing.due ? { dueDate: thing.due, date: thing.due } : {}) }
      return { kind: 'task', defaults: { ...defaults, domain: 'personal' }, source: { link: { kind: 'shop_item', id: thing.id } } }
    }
    case 'wish':
      return { kind: 'task', defaults: { title: thing.title }, source: { link: { kind: 'wish', id: thing.id } } }
    case 'football': {
      const m = thing.match
      const mi = matchItem(m)
      return {
        kind: 'task',
        defaults: {
          title: mi.title, notes: mi.notes ?? undefined, date: mi.date, dueDate: mi.date, domain: 'personal', category: MATCH_CATEGORY,
          timeZone: MATCH_TIME_ZONE,
          ...(mi.time ? { startTime: mi.time, duration: mi.durationMinutes ?? undefined, scheduled: true } : {}),
        },
        // The match's record is written with the item (211): one transaction, never a second request.
        source: { link: { kind: 'football', match: { eventId: m.id, league: m.league?.slug ?? '', kickoffAt: m.kickoff, timeValid: m.timeValid } } },
      }
    }
    case 'training':
      return {
        kind: 'time-block',
        defaults: { title: thing.routine?.title ?? 'Training', category: 'training', color: 'accent', ...(thing.date ? { date: thing.date } : {}) },
        // A session without a routine is still a training task, so a workout logged that day can close it.
        source: thing.routine
          ? { sourceType: 'training_session', sourceId: thing.routine.id, taskSourceType: 'training_session', link: { kind: 'training', id: thing.routine.id } }
          : { sourceType: 'training_session', taskSourceType: 'training_session' },
        ...(thing.onSaved ? { onSaved: () => thing.onSaved?.() } : {}),
      }
  }
}
