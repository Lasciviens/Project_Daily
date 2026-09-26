import { useMemo, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { EmptyState, PageContainer, PageHeader, Skeleton } from '../../../shared/ui'
import { useEntityModal } from '../../../shared/modals'
import { todayStr } from '../../../shared/utils/dateUtils'
import { useWishes, useUpdateWish, useDeleteWish } from '../hooks/useWishes'
import { resolveWishWindow, type WishWindowState } from '../wishRules'
import { WishCard } from '../components/WishCard'
import { WishQuickAdd } from '../components/WishQuickAdd'
import { WishFilters, type KindFilter, type StatusFilter } from '../components/WishFilters'
import type { WishItem } from '../types'

// Filters only narrow what is DISPLAYED; "Everything" always brings the whole
// list back, and no filter ever touches a stored row.
function matchesFilters(w: WishItem, kind: KindFilter, status: StatusFilter): boolean {
  if (kind !== 'all' && w.kind !== kind) return false
  if (status === 'all')    return true
  if (status === 'active') return w.status === 'idea' || w.status === 'planned'
  return w.status === status
}

// Order is the whole reading of the page: what a season has opened first, what
// is coming next, the undated pile, and Passed last — quiet but still there.
// A wish is never hidden, only ranked.
const GROUPS: { state: WishWindowState; title: string; note?: string }[] = [
  { state: 'open',     title: 'Open now' },
  { state: 'upcoming', title: 'Coming up' },
  { state: 'anytime',  title: 'Anytime' },
  { state: 'passed',   title: 'Passed', note: 'The season went by — nothing here is late. These stay until you tick or delete them.' },
]

const GRID = 'grid grid-cols-1 sm:grid-cols-[repeat(auto-fill,minmax(15rem,18rem))] justify-start items-start gap-3'

export function WishesPage() {
  const today = todayStr()
  const modal = useEntityModal()
  const { data: wishes = [], isLoading } = useWishes()
  const update = useUpdateWish()
  const remove = useDeleteWish()

  const [kind, setKind]     = useState<KindFilter>('all')
  const [status, setStatus] = useState<StatusFilter>('active')

  const groups = useMemo(() => {
    const shown = wishes.filter(w => matchesFilters(w, kind, status))
    return GROUPS
      .map(g => ({ ...g, items: shown.filter(w => resolveWishWindow(w, today) === g.state) }))
      .filter(g => g.items.length > 0)
  }, [wishes, kind, status, today])

  const openCount = wishes.filter(
    w => (w.status === 'idea' || w.status === 'planned') && resolveWishWindow(w, today) === 'open',
  ).length

  // Promotion: the task is the commitment, the wish stays as the memory — so
  // this only flips the wish to 'planned' and records which task came out of it.
  function plan(wish: WishItem) {
    modal.open({
      kind: 'task',
      config: { heading: 'Plan this wish' },
      defaults: { title: wish.title },
      onSaved: result => update.mutate({
        id: wish.id,
        patch: { status: 'planned', ...(result.taskId ? { promoted_task_id: result.taskId } : {}) },
      }),
    })
  }

  async function confirmDelete(wish: WishItem) {
    if (await modal.confirm({ title: 'Delete this wish?', message: wish.title, confirmLabel: 'Delete', destructive: true })) {
      remove.mutate(wish.id)
    }
  }

  return (
    <PageContainer>
      <PageHeader
        title="Wishes"
        subtitle={wishes.length > 0 ? `${openCount} open now · ${wishes.length} total` : undefined}
      />
      <p className="-mt-2 mb-4 max-w-md text-body text-fg-muted">
        Things you want to do, not things you must. A season only decides when they come back to you — never when they are late.
      </p>

      <WishQuickAdd />

      {wishes.length > 0 && (
        <div className="mt-5">
          <WishFilters kind={kind} status={status} onKind={setKind} onStatus={setStatus} />
        </div>
      )}

      {isLoading ? (
        <div className={`${GRID} mt-5`}>
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} rounded="rounded-card" className="h-32" />)}
        </div>
      ) : wishes.length === 0 ? (
        <EmptyState
          className="mt-5 max-w-md"
          bordered
          icon={<Sparkles />}
          title="Nothing on your wish list yet"
          description="Add a season and they'll come back to you when it starts."
        />
      ) : groups.length === 0 ? (
        <p className="mt-6 text-body text-fg-muted">Nothing matches these filters.</p>
      ) : (
        groups.map(group => (
          <section key={group.state} className="mt-6">
            <h2 className={`flex items-center gap-2 text-lead font-semibold ${group.state === 'passed' ? 'text-fg-muted' : 'text-fg'}`}>
              {group.title}
              <span className="count-badge">{group.items.length}</span>
            </h2>
            {group.note && <p className="mt-0.5 max-w-md text-meta text-fg-muted">{group.note}</p>}
            <div className={`${GRID} mt-2`}>
              {group.items.map(wish => (
                <WishCard
                  key={wish.id}
                  wish={wish}
                  today={today}
                  onEdit={() => modal.open({ kind: 'wish', id: wish.id })}
                  onPlan={() => plan(wish)}
                  onStatus={s => update.mutate({ id: wish.id, patch: { status: s } })}
                  onDelete={() => { void confirmDelete(wish) }}
                />
              ))}
            </div>
          </section>
        ))
      )}
    </PageContainer>
  )
}
