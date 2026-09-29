import { useEffect, useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import { PictureInPicture2 } from 'lucide-react'
import { useDevRequestDrafts } from '../devRequestDraftStore'
import { draftFromRow, isDraftEmpty, type DraftFields } from '../devRequestRules'
import { discardEditDraft, discardNewDraft, useSaveDevRequestDraft } from '../hooks/useDevRequestDraft'
import { usePageContextReader } from '../pick/usePageContext'
import { RequestFields } from './RequestFields'
import { PageContextToggle } from './PageContextToggle'
import { pageOptionFor } from './devRequestMeta'
import type { DevRequest } from '../types'
import { Button, IconButton } from '../../../shared/ui'

/**
 * The drawer's inline new-request form (phones; tablet/desktop write in the
 * floating composer). Its text lives in the draft store, so closing the
 * drawer, leaving the page or reloading keeps it.
 */
export function DevRequestNewForm({ onClose, onPopOut }: { onClose: () => void; onPopOut: () => void }) {
  const draft = useDevRequestDrafts(s => s.newDraft)
  const patch = useDevRequestDrafts(s => s.patchNewDraft)
  const readPage = usePageContextReader()
  const { pathname } = useLocation()
  const { saveNew, pending } = useSaveDevRequestDraft()

  // An empty draft belongs to the page it is opened on.
  useEffect(() => {
    useDevRequestDrafts.getState().beginNewDraft(readPage(), pageOptionFor(pathname))
    // Once per opening, not on every route change while open.
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function submit(e: React.FormEvent) {
    e.preventDefault()
    void saveNew(readPage(), onClose)
  }
  // The form stays open: the emptied draft still belongs to this page.
  const discard = () => discardNewDraft({ start: readPage(), page: pageOptionFor(pathname) })

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 border-b border-line p-3 sm:px-4">
      <RequestFields fields={draft} onChange={patch} autoFocusTitle={isDraftEmpty(draft)} />
      <PageContextToggle start={draft.start} checked={draft.attachContext} onChange={v => patch({ attachContext: v })} />
      <div className="flex items-center gap-2">
        <Button type="submit" variant="primary" size="sm" loading={pending} disabled={!draft.title.trim()} className="flex-1">
          Add request
        </Button>
        <IconButton label="Pop out — keep writing while you browse" onClick={onPopOut}><PictureInPicture2 /></IconButton>
        {!isDraftEmpty(draft) && <Button variant="ghost" size="sm" onClick={discard}>Discard</Button>}
        <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
      </div>
    </form>
  )
}

/**
 * Edit one request in place. Unsaved changes are a draft too: Close keeps
 * them (the card says so), Discard drops them.
 */
export function DevRequestEditForm({ request, onClose, onPopOut }: { request: DevRequest; onClose: () => void; onPopOut: () => void }) {
  const seed = useMemo(() => draftFromRow(request), [request])
  const draft = useDevRequestDrafts(s => s.editDrafts[request.id])
  const patchEdit = useDevRequestDrafts(s => s.patchEditDraft)
  const fields: DraftFields = draft ?? seed
  const { saveEdit, pending } = useSaveDevRequestDraft()
  const isDone = request.status === 'done'

  function submit(e: React.FormEvent) {
    e.preventDefault()
    void saveEdit(request.id, fields, undefined, onClose)
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 rounded-row border border-accent-500/30 bg-accent-50/40 p-2.5">
      <RequestFields fields={fields} onChange={p => patchEdit(request.id, p, seed)} />
      {draft && (
        <p className="flex items-center gap-2 px-1 text-meta text-fg-muted">
          <span data-tone="warn" className="tone-dot" aria-hidden />
          Unsaved changes, kept on this device
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" size="sm" loading={pending} disabled={!fields.title.trim()}>Save</Button>
        <Button size="sm" disabled={pending} onClick={() => void saveEdit(request.id, fields, isDone ? 'open' : 'done', onClose)}>
          {isDone ? 'Reopen' : 'Mark done'}
        </Button>
        <IconButton label="Pop out — keep editing while you browse" onClick={onPopOut}><PictureInPicture2 /></IconButton>
        <span className="ml-auto flex items-center gap-1">
          {draft && <Button variant="ghost" size="sm" onClick={() => discardEditDraft(request)}>Discard</Button>}
          <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
        </span>
      </div>
    </form>
  )
}
