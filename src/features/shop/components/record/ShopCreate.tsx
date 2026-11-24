import { SkipForward } from 'lucide-react'
import { ModalShell } from '../../../../shared/modals/ModalShell'
import { Button, Skeleton, TonePill, Truncate } from '../../../../shared/ui'
import { useShopCategories } from '../../hooks/useShop'
import { RecordBody } from './RecordBody'
import { useCreateRecord } from './useCreateRecord'
import { newCategoryMissing } from './useRecordDraft'
import type { CreateBatch, CreateSpec } from './createDraft'
import type { ShopCategory, ShopItem } from '../../types'

/**
 * A new Shop thing — the one body in mode add (owner, 23.11.2026: "the same exact popup with every field"; 24.11.2026: one
 * screen). This frame is the popup, its title and its footer (Skip, Cancel, Add another, Save); every field, the picture, the
 * autofill and the receipt are the body's (`RecordBody`). The preset says what is made — a wish, a general wish, something you
 * own or had, an accessory, a model — with its own defaults, toast and links. A read receipt's lines are several drafts in one
 * popup: "1 of 3 ‹ ›", each kept while the owner moves, each saved on its own or skipped.
 */
export function ShopCreate(props: { spec: CreateSpec; batch?: CreateBatch; onSaved?: (item: ShopItem) => void; onClose: () => void }) {
  const cats = useShopCategories()
  if (!cats.isSuccess) {
    return (
      <ModalShell onClose={props.onClose} title={cats.isError ? "Can't load the categories" : 'Loading…'} size="xl" mobile="fullscreen">
        {cats.isError
          ? <p className="text-body text-fg-muted">Close this and try again in a moment.</p>
          : <div className="space-y-2"><Skeleton className="h-11 w-full" /><Skeleton className="h-11 w-full" /><Skeleton className="h-24 w-full" /></div>}
      </ModalShell>
    )
  }
  return <CreateFrame {...props} categories={cats.data} />
}

function CreateFrame(props: { spec: CreateSpec; batch?: CreateBatch; onSaved?: (item: ShopItem) => void; onClose: () => void; categories: ShopCategory[] }) {
  const c = useCreateRecord(props)
  const { st, missing, saving, count } = c
  const footer = (
    <div className="flex items-center gap-2">
      <span className="min-w-0 flex-1 text-meta text-fg-muted">
        {st.savedId ? <span className="text-success">✓ Saved</span>
          : c.added.length > 0 ? <>Added: <Truncate as="span">{c.added.join(', ')}</Truncate></>
          : missing ? `Needs ${missing}` : null}
      </span>
      {count > 1 && !st.savedId && <Button icon={<SkipForward />} onClick={c.skip} disabled={saving} tip="Skip this line">Skip</Button>}
      <Button onClick={() => { void c.close() }} disabled={saving}>{c.added.length || st.savedId ? 'Done' : 'Cancel'}</Button>
      {c.spec.preset === 'accessory' && <Button onClick={() => { void c.save(true) }} disabled={!!missing} loading={saving} tip="Save and add another accessory">Another</Button>}
      <Button variant="primary" onClick={() => { void c.save() }} disabled={!!missing || !!st.savedId || !!newCategoryMissing(st.draft)} loading={saving || c.categoryBusy}
        tip={c.hasNext ? 'Save and go to the next line' : undefined}>
        {c.hasNext ? 'Save, next' : 'Save'}
      </Button>
    </div>
  )
  return (
    <ModalShell onClose={c.close} title={c.title} subtitle={c.subtitle} wrapTitle size="xl" mobile="fullscreen" dismissible={!saving}
      headerActions={<TonePill tone={c.pill.tone} className="shrink-0 max-sm:hidden">{c.pill.label}</TonePill>}
      footer={footer}>
      {/* A line of a read receipt is its own draft: the body starts again when the owner moves to another line. */}
      <RecordBody key={c.index} mode="add" c={c} />
    </ModalShell>
  )
}
