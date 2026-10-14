import { useState } from 'react'
import { Undo2 } from 'lucide-react'
import { ModalShell } from '../../../shared/modals'
import { Button, SectionLabel, SkeletonText, ToneDot } from '../../../shared/ui'
import { useUndoPlan, useUndoSave } from '../hooks/useUndoSave'
import { describeUndoPlan, type UndoLine } from './undoPlanText'

// The preview before "Undo this save" (migration 150): what was changed again
// later comes first (Undo would overwrite it), then what can't be undone,
// then what changes — then Undo / Cancel. The plan is the database's own trial
// run, so what is listed is what runs; if anything changes in between, the
// database refuses and the plan is read again.

const CONFLICTS_SHOWN = 5

function Lines({ lines, cap }: { lines: UndoLine[]; cap?: number }) {
  const [all, setAll] = useState(false)
  const shown = cap && !all ? lines.slice(0, cap) : lines
  return (
    <>
      <ul className="flex flex-col gap-1.5">
        {shown.map((l, i) => (
          <li key={i} className="flex items-start gap-2 text-body text-fg-2">
            <ToneDot tone={l.tone} className="mt-1.5 shrink-0" />
            <span className="min-w-0 break-words">
              {l.text}
              {l.detail && <span className="block text-meta text-fg-muted">{l.detail}</span>}
            </span>
          </li>
        ))}
      </ul>
      {cap !== undefined && lines.length > cap && (
        <button type="button" className="mt-1 self-start text-meta font-semibold text-accent-600" onClick={() => setAll(a => !a)}>
          {all ? 'Show fewer' : `Show all ${lines.length}`}
        </button>
      )}
    </>
  )
}

function Section({ label, lines, cap }: { label: string; lines: UndoLine[]; cap?: number }) {
  if (!lines.length) return null
  return (
    <section className="flex flex-col gap-1.5">
      <SectionLabel>{label}</SectionLabel>
      <Lines lines={lines} cap={cap} />
    </section>
  )
}

/**
 * `onUndoAgain` opens this sheet for the undo's own save — the result toast's
 * Undo, so taking an undo back gets the same preview first.
 */
export function UndoSaveSheet({ txId, onClose, onUndoAgain }: {
  txId: number | null
  onClose: () => void
  onUndoAgain: (txId: number) => void
}) {
  const plan = useUndoPlan(txId)
  const undo = useUndoSave(onUndoAgain)
  // The last plan stays on screen while the sheet closes; a new save never shows another save's plan.
  const data = txId === null || !plan.isPlaceholderData ? plan.data : undefined
  const view = data ? describeUndoPlan(data) : null
  const busy = undo.isPending

  async function run() {
    if (!data || txId === null) return
    try {
      await undo.mutateAsync({ txId, confirm: data.confirm })
    } catch {
      // the hook said why (e.g. changed since the preview): show the plan as it is now
      void plan.refetch()
      return
    }
    onClose()
  }

  let body
  if (!view && plan.error) {
    body = (
      <div className="flex flex-col items-start gap-2">
        <p className="text-body text-fg-2">{(plan.error as Error).message}</p>
        <Button size="sm" onClick={() => { void plan.refetch() }}>Try again</Button>
      </div>
    )
  } else if (!view) {
    body = <SkeletonText lines={4} />
  } else {
    body = (
      <div className="flex flex-col gap-4">
        {view.error && <p data-tone="danger" className="tone-soft rounded-row px-3 py-2 text-body">{view.error}</p>}
        {view.nothingToDo && (
          <p className="text-body text-fg-2">Nothing to undo — everything this save changed is already as it was.</p>
        )}
        <Section label="Changed again later" lines={view.conflicts} cap={CONFLICTS_SHOWN} />
        <Section label="Not exactly as before" lines={view.drift} cap={CONFLICTS_SHOWN} />
        <Section label="Can't be undone" lines={view.blocked} />
        <Section label="What Undo changes" lines={view.changes} />
        <Section label="Also affected" lines={view.also} cap={CONFLICTS_SHOWN} />
        <ul className="flex list-disc flex-col gap-0.5 pl-4 text-meta text-fg-muted">
          {view.notes.map(note => <li key={note}>{note}</li>)}
        </ul>
      </div>
    )
  }

  return (
    <ModalShell
      open={txId !== null}
      onClose={onClose}
      size="md"
      dismissible={!busy}
      title="Undo this save"
      subtitle={view?.subtitle}
      footer={
        <div className="flex gap-2 sm:justify-end">
          <Button block className="sm:w-auto" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button
            block
            className="sm:w-auto"
            variant={data?.needs_confirm ? 'danger' : 'primary'}
            icon={<Undo2 />}
            loading={busy}
            disabled={!view?.canUndo || plan.isFetching}
            onClick={() => { void run() }}
          >
            {view?.confirmLabel ?? 'Undo'}
          </Button>
        </div>
      }
    >
      {body}
    </ModalShell>
  )
}
