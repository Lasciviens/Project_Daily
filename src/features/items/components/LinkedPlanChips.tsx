import { CalendarCheck, CalendarPlus } from 'lucide-react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../../../shared/ui'
import { useEntityModal } from '../../../shared/modals'
import { formatDate } from '../../../shared/utils/dateFormat'
import type { ThingTarget } from '../linkApi'
import { episodeCode, LINK_KINDS, type TaskLink } from '../linkKinds'
import type { ItemLinkKind } from '../itemTypes'
import { useLinkedThing, useOpenPlan, usePlanThis } from '../usePlanThis'
import type { PlanThing } from '../planThis'

// The two ends of a linked plan (Phase 3 A2): the item screen's "Linked" chip opens the thing the task plans, and the
// thing's own screen shows "Planned 28.11.2026", which opens the plan — or, with no open plan, its Plan button.

/** Opens what a Linked chip names: the thing's popup on top of the item screen, or its page. */
function useOpenThing() {
  const modal = useEntityModal()
  const navigate = useNavigate()
  return (t: ThingTarget) => {
    switch (t.kind) {
      case 'media': modal.open({ kind: 'media', tmdbId: t.tmdbId, mediaType: t.mediaType }); return
      case 'shop-item': modal.open({ kind: 'shop-item', id: t.id }); return
      case 'wish': modal.open({ kind: 'wish', id: t.id }); return
      case 'football-match': modal.open({ kind: 'football-match', eventId: t.eventId, league: t.league }); return
      case 'book': modal.open({ kind: 'book', id: t.id }); return
      // A page: the route change closes the popups (AppShell). The Games page opens the game in its own details.
      case 'game':
        void import('../../games/test-game/testGameStore').then(m => { m.useTestGameStore.getState().openDetail(t.id); navigate('/games') })
        return
      case 'route': navigate(t.path); return
    }
  }
}

/** The item screen's header chip: what this item plans, opened with a tap. Nothing for an item with no link. */
export function LinkedChip({ link }: { link: TaskLink | null }) {
  const thing = useLinkedThing(link)
  const open = useOpenThing()
  if (!link) return null
  const def = LINK_KINDS[link.kind]
  const Icon = def.icon
  const name = [thing.data?.title, link.season != null && link.episode != null ? episodeCode(link.season, link.episode) : null].filter(Boolean).join(' · ')
  const target = thing.data?.target ?? null
  const tip = thing.isLoading ? `Linked — ${def.label}`
    : target ? `Linked — open the ${def.label.toLowerCase()}${name ? `: ${name}` : ''}`
    : `Linked — the ${def.label.toLowerCase()} is not there any more`
  return (
    <Button size="sm" variant="ghost" icon={<Icon aria-hidden />} tip={tip} disabled={!target}
      onClick={() => { if (target) open(target) }} data-testid="linked-chip">
      Linked
    </Button>
  )
}

/**
 * A thing's Plan button and its reverse chip in one: "Planned 28.11.2026" opens its open plan; with none, `label`
 * plans it through usePlanThis. `planned`: the thing whose open plan the chip shows, when it differs from the Plan's
 * own (a show: any of its episodes' plans).
 */
export function PlanThingButton({ thing, planned, label = 'Plan', tip, icon, variant = 'secondary', className }: {
  thing: PlanThing
  planned?: { kind: ItemLinkKind; id: string | null | undefined }
  label?: string
  tip: string
  icon?: ReactNode
  variant?: 'primary' | 'secondary' | 'ghost'
  className?: string
}) {
  const plan = usePlanThis()
  const own = planned ?? ownPlanKey(thing)
  const open = useOpenPlan(own?.kind ?? 'movie', own?.id)
  if (open.data) return <PlannedChip kind={own?.kind ?? 'movie'} id={own?.id} variant={variant} className={className} />
  return (
    <Button size="sm" variant={variant} icon={icon ?? <CalendarPlus aria-hidden />} className={className} tip={tip}
      onClick={() => { void plan(thing) }}>
      {label}
    </Button>
  )
}

function ownPlanKey(thing: PlanThing): { kind: ItemLinkKind; id: string | null | undefined } | undefined {
  switch (thing.kind) {
    case 'movie': case 'tv': return { kind: thing.kind, id: thing.id }
    case 'game': case 'shop_item': case 'wish': return { kind: thing.kind, id: thing.id }
    case 'training': return { kind: 'training', id: thing.routine?.id }
    case 'football': return undefined
  }
}

/** The reverse chip alone: "Planned 28.11.2026" while the thing has an open plan (it opens the plan); nothing else. */
export function PlannedChip({ kind, id, variant = 'secondary', className }: {
  kind: ItemLinkKind
  id: string | null | undefined
  variant?: 'primary' | 'secondary' | 'ghost'
  className?: string
}) {
  const modal = useEntityModal()
  const p = useOpenPlan(kind, id).data
  if (!p) return null
  return (
    <Button size="sm" variant={variant} icon={<CalendarCheck aria-hidden />} className={className} data-testid="planned-chip"
      tip={`Planned${p.day ? ` ${formatDate(p.day)}` : ''} — open “${p.title}”`} onClick={() => modal.open({ kind: 'task', id: p.taskId })}>
      {p.day ? `Planned ${formatDate(p.day)}` : 'Planned'}
    </Button>
  )
}
