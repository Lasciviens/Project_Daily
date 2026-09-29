import { useMemo, type Ref } from 'react'
import { useLocation } from 'react-router-dom'
import { Crosshair, Quote } from 'lucide-react'
import { useDevRequestDrafts } from '../devRequestDraftStore'
import { countBlocks } from '../devRequestContext'
import { draftFromRow, isDraftEmpty, type ComposerTarget, type DraftFields } from '../devRequestRules'
import { useDevRequests } from '../hooks/useDevRequests'
import { discardEditDraft, discardNewDraft, useSaveDevRequestDraft } from '../hooks/useDevRequestDraft'
import { RequestFields } from '../components/RequestFields'
import { PageContextToggle } from '../components/PageContextToggle'
import { pageOptionFor } from '../components/devRequestMeta'
import type { PageContext } from '../devRequestContext'
import { Button, Skeleton, cx } from '../../../shared/ui'

interface Props {
  target: ComposerTarget
  readPage: () => PageContext
  onPick: () => void
  onQuote: (() => void) | null
  /** With a mouse: an Alt-click picks too. */
  altHint: boolean
  flash: boolean
  titleRef: Ref<HTMLInputElement>
  descriptionRef: Ref<HTMLTextAreaElement>
  /** A save went through (for the request it was made for). */
  onDone: (saved: ComposerTarget) => void
}

/** The composer's Request tab: the request's fields, pick tools and save. */
export function ComposerRequestTab({ target, readPage, onPick, onQuote, altHint, flash, titleRef, descriptionRef, onDone }: Props) {
  const { pathname } = useLocation()
  const { data: requests, isLoading } = useDevRequests()
  const row = target.kind === 'edit' ? requests?.find(r => r.id === target.id) ?? null : null
  const seed = useMemo(() => (row ? draftFromRow(row) : null), [row])
  const newDraft = useDevRequestDrafts(s => s.newDraft)
  const editDraft = useDevRequestDrafts(s => (target.kind === 'edit' ? s.editDrafts[target.id] : undefined))
  const { saveNew, saveEdit, pending } = useSaveDevRequestDraft()

  if (target.kind === 'edit' && !row) {
    if (isLoading) return <div className="flex flex-col gap-2 p-3"><Skeleton className="h-10" /><Skeleton className="h-32" /></div>
    return (
      <div className="flex flex-col items-start gap-3 p-4 text-body text-fg-muted">
        <p>This request no longer exists.</p>
        <Button size="sm" onClick={() => {
          const s = useDevRequestDrafts.getState()
          s.clearEditDraft(target.id)
          s.beginNewDraft(readPage(), pageOptionFor(pathname))
          s.openComposer({ kind: 'new' })
        }}>Write a new request</Button>
      </div>
    )
  }

  const fields: DraftFields = target.kind === 'new' ? newDraft : (editDraft ?? seed!)
  const onChange = (p: Partial<DraftFields>) => {
    const s = useDevRequestDrafts.getState()
    if (target.kind === 'new') s.patchNewDraft(p)
    else s.patchEditDraft(target.id, p, seed!)
  }
  const picks = countBlocks(fields.description)

  const done = () => onDone(target)
  function save() {
    if (target.kind === 'new') void saveNew(readPage(), done)
    else void saveEdit(target.id, fields, undefined, done)
  }
  // The emptied draft still belongs to the page it is written on.
  const discardNew = () => discardNewDraft({ start: readPage(), page: pageOptionFor(pathname) })

  const tools = (
    <div className="flex flex-wrap items-center gap-1.5">
      <Button size="sm" icon={<Crosshair />} onClick={onPick} title="Point at something on the page to add where it is">Pick on page</Button>
      {onQuote && (
        // mousedown would clear the page selection before the click reads it.
        <Button size="sm" variant="ghost" icon={<Quote />} onMouseDown={e => e.preventDefault()} onClick={onQuote}>Quote selection</Button>
      )}
      <span className="min-w-0 flex-1 text-meta text-fg-muted">
        {picks > 0 ? `${picks} context block${picks === 1 ? '' : 's'} added` : altHint ? 'or Alt-click anything' : ''}
      </span>
    </div>
  )

  return (
    <>
      <div className="scroll-y min-h-0 flex-1 overflow-y-auto p-3">
        <RequestFields
          fields={fields}
          onChange={onChange}
          titleRef={titleRef}
          descriptionRef={descriptionRef}
          descriptionClassName={cx('min-h-[140px] transition-shadow', flash && 'ring-2 ring-accent-500/40')}
          descriptionTools={tools}
        />
        {target.kind === 'new' && (
          <div className="mt-1.5">
            <PageContextToggle start={newDraft.start} checked={newDraft.attachContext} onChange={v => useDevRequestDrafts.getState().patchNewDraft({ attachContext: v })} />
          </div>
        )}
      </div>
      <footer className="flex shrink-0 items-center gap-2 border-t border-line px-3 py-2.5">
        {target.kind === 'new'
          ? !isDraftEmpty(newDraft) && <Button variant="ghost" size="sm" onClick={discardNew}>Discard</Button>
          : editDraft && row && <Button variant="ghost" size="sm" onClick={() => discardEditDraft(row)}>Discard changes</Button>}
        {target.kind === 'edit' && row && (
          <Button size="sm" disabled={pending} onClick={() => void saveEdit(row.id, fields, row.status === 'done' ? 'open' : 'done', done)}>
            {row.status === 'done' ? 'Reopen' : 'Mark done'}
          </Button>
        )}
        <Button variant="primary" size="sm" loading={pending} disabled={!fields.title.trim()} onClick={save} className="ml-auto">
          {target.kind === 'new' ? 'Add request' : 'Save'}
        </Button>
      </footer>
    </>
  )
}
