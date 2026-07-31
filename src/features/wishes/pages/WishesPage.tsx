import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { EmptyState } from '../../../shared/components/EmptyState'
import { ConfirmDialog } from '../../../shared/components/ConfirmDialog'
import { UnifiedPlanModal } from '../../../shared/components/plan-modal'
import { todayStr } from '../../../shared/utils/dateUtils'
import { useWishes, useUpdateWish, useDeleteWish } from '../hooks/useWishes'
import { resolveWishWindow, type WishWindowState } from '../wishRules'
import { WishCard } from '../components/WishCard'
import { WishQuickAdd } from '../components/WishQuickAdd'
import { WishSheet } from '../components/WishSheet'
import { WishFilters, type KindFilter, type StatusFilter } from '../components/WishFilters'
import type { WishItem, WishStatus } from '../types'

// Filters only narrow what is DISPLAYED; "Everything" always brings the whole
// list back, and no filter ever touches a stored row.
function matchesFilters(w: WishItem, kind: KindFilter, status: StatusFilter): boolean {
  if (kind !== 'all' && w.kind !== kind) return false
  if (status === 'all')    return true
  if (status === 'active') return w.status === 'idea' || w.status === 'planned'
  return w.status === status
}

// Order is the whole reading of the page: what a season has opened comes first,
// what is coming next after it, then the undated pile — and Passed last, quiet
// but still there. A wish is never hidden, only ranked.
const GROUPS: { state: WishWindowState; title: string; note?: string }[] = [
  { state: 'open',     title: 'Open now' },
  { state: 'upcoming', title: 'Coming up' },
  { state: 'anytime',  title: 'Anytime' },
  { state: 'passed',   title: 'Passed', note: 'The season went by — nothing here is late. These stay until you tick or delete them.' },
]

const GRID = 'grid grid-cols-[repeat(auto-fill,minmax(15rem,18rem))] justify-start gap-3 items-start'

export function WishesPage() {
  const today = todayStr()
  const qc = useQueryClient()
  const { data: wishes = [], isLoading } = useWishes()
  const update = useUpdateWish()
  const remove = useDeleteWish()

  const [kind, setKind]         = useState<KindFilter>('all')
  const [status, setStatus]     = useState<StatusFilter>('active')
  const [editing, setEditing]   = useState<WishItem | null>(null)
  const [planning, setPlanning] = useState<WishItem | null>(null)
  const [deleting, setDeleting] = useState<WishItem | null>(null)

  const groups = useMemo(() => {
    const shown = wishes.filter(w => matchesFilters(w, kind, status))
    return GROUPS
      .map(g => ({ ...g, items: shown.filter(w => resolveWishWindow(w, today) === g.state) }))
      .filter(g => g.items.length > 0)
  }, [wishes, kind, status, today])

  const openCount = wishes.filter(
    w => (w.status === 'idea' || w.status === 'planned') && resolveWishWindow(w, today) === 'open',
  ).length

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
      <div className="mb-1 flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-bold text-ink-900">Wishes</h1>
        {wishes.length > 0 && (
          <span className="rounded-full border border-ink-200 bg-cream-50/70 px-2 py-0.5 text-xs font-medium text-ink-600">
            {openCount} open now · {wishes.length} total
          </span>
        )}
      </div>
      <p className="mb-4 max-w-md text-xs text-ink-500">
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
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-32 animate-pulse rounded-2xl bg-cream-50/40" />
          ))}
        </div>
      ) : wishes.length === 0 ? (
        <EmptyState
          className="max-w-md"
          bordered
          icon="✨"
          title="Nothing on your wish list yet"
          description="Things you want to do, not things you must. Add a season and they'll come back to you when it starts."
        />
      ) : groups.length === 0 ? (
        <p className="mt-6 text-sm text-ink-500">Nothing matches these filters.</p>
      ) : (
        groups.map(group => (
          <section key={group.state} className="mt-6">
            <h2 className={`text-sm font-semibold ${group.state === 'passed' ? 'text-ink-400' : 'text-ink-700'}`}>
              {group.title}
              <span className="ml-1.5 text-xs font-normal text-ink-400">{group.items.length}</span>
            </h2>
            {group.note && <p className="mt-0.5 max-w-md text-xs text-ink-400">{group.note}</p>}
            <div className={`${GRID} mt-2`}>
              {group.items.map(wish => (
                <WishCard
                  key={wish.id}
                  wish={wish}
                  today={today}
                  onEdit={() => setEditing(wish)}
                  onPlan={() => setPlanning(wish)}
                  onStatus={(s: WishStatus) => update.mutate({ id: wish.id, patch: { status: s } })}
                  onDelete={() => setDeleting(wish)}
                />
              ))}
            </div>
          </section>
        ))
      )}

      {editing && <WishSheet key={editing.id} wish={editing} onClose={() => setEditing(null)} />}

      {/* Promotion: the task is the commitment, the wish stays as the memory —
          so this only flips the wish to 'planned' and records which task came
          out of it. Nothing here deletes or completes the wish. */}
      {planning && (
        <UnifiedPlanModal
          open
          onClose={() => setPlanning(null)}
          config={{ tabs: ['task', 'schedule'], heading: 'Plan this wish' }}
          defaults={{ title: planning.title }}
          onSaved={result => {
            update.mutate({
              id: planning.id,
              patch: { status: 'planned', ...(result.taskId ? { promoted_task_id: result.taskId } : {}) },
            })
            qc.invalidateQueries({ queryKey: ['tasks'] })
          }}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        title="Delete this wish?"
        message={deleting?.title}
        onConfirm={() => { if (deleting) remove.mutate(deleting.id) }}
        onClose={() => setDeleting(null)}
      />
    </div>
  )
}
