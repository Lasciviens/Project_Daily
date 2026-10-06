import { useState, type Ref } from 'react'
import { ChevronRight, Copy, ListChecks, RotateCcw, Sparkles } from 'lucide-react'
import { useDevRequestDrafts } from '../devRequestDraftStore'
import { descriptionPreview } from '../devRequestMarks'
import { buildClaudePrompt } from '../devRequestPrompt'
import { useDevRequests, useMarkDevRequestsPrompted } from '../hooks/useDevRequests'
import { toast, useUIStore } from '../../../app/store'
import { Button, EmptyState, Skeleton, Truncate, cx } from '../../../shared/ui'

/**
 * The prompt for Claude — its own step, never part of writing a request:
 * built from the requests ticked in the Requests list ("Build prompt"),
 * editable here (your wording is kept with the drafts until Reset), copied
 * with one button. Building and copying mark the requests Prompted, which is
 * what turns on their Fixed / Not fixed review.
 */
export function ComposerPromptView({ textareaRef }: { textareaRef?: Ref<HTMLTextAreaElement> }) {
  const prompt = useDevRequestDrafts(s => s.prompt)
  const { data: requests = [], isLoading } = useDevRequests()
  const [showList, setShowList] = useState(false)
  const markPrompted = useMarkDevRequestsPrompted()
  const rows = prompt.ids.map(id => requests.find(r => r.id === id)).filter(r => r != null)
  // Until the list has loaded, every picked request would read as deleted.
  const count = isLoading ? prompt.ids.length : rows.length
  const missing = isLoading ? 0 : prompt.ids.length - rows.length

  function changeSelection() {
    const picked = isLoading ? prompt.ids : rows.map(r => r.id)
    useDevRequestDrafts.getState().setDrawer({ picked })
    if (!useUIStore.getState().isDevRequestsOpen) useUIStore.getState().toggleDevRequests()
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt.text)
      toast.success('Prompt copied')
      // The requests now wait for a check ("Prompted" on their cards).
      if (rows.length) markPrompted.mutate(rows.map(r => r.id))
    } catch {
      toast.error("Couldn't copy — select the text and copy it by hand")
    }
  }

  if (!prompt.text.trim() && prompt.ids.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col justify-center p-4">
        <EmptyState
          icon={<Sparkles />}
          title="No prompt yet"
          description="Tick requests in the Requests list, then Build prompt."
          action={<Button size="sm" icon={<ListChecks />} onClick={changeSelection}>Pick requests</Button>}
        />
      </div>
    )
  }

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 px-4 pb-3 pt-3">
        <p className="text-meta text-fg-muted">Paste it into a Claude Code session. The requests are marked Prompted, so you can check each point afterwards.</p>
        <div className="flex items-center gap-2 rounded-row border border-line bg-surface-2 py-1 pl-1 pr-1.5">
          <button
            type="button"
            onClick={() => setShowList(v => !v)}
            aria-expanded={showList}
            className="flex min-h-[36px] min-w-0 flex-1 items-center gap-1.5 rounded-control px-1.5 text-left text-body font-semibold text-fg-2 [@media(hover:hover)]:hover:text-fg [@media(pointer:coarse)]:min-h-[44px]"
          >
            <ChevronRight className={cx('h-4 w-4 shrink-0 text-fg-muted transition-transform', showList && 'rotate-90')} aria-hidden />
            <Truncate>{`${count} request${count === 1 ? '' : 's'} included${missing > 0 ? ` · ${missing} deleted` : ''}`}</Truncate>
            {prompt.edited && <span data-tone="warn" className="tone-pill shrink-0">Edited</span>}
          </button>
          <Button size="sm" variant="ghost" onClick={changeSelection}>Change</Button>
        </div>
        {showList && isLoading && <Skeleton className="h-10 rounded-row" />}
        {showList && !isLoading && (
          <ul className="flex max-h-40 flex-col divide-y divide-line overflow-y-auto rounded-row border border-line">
            {rows.map(r => (
              <li key={r.id} className="px-3 py-2">
                <Truncate className="text-body font-medium text-fg">{r.title}</Truncate>
                {descriptionPreview(r.description) && <Truncate className="text-meta text-fg-muted">{descriptionPreview(r.description)}</Truncate>}
              </li>
            ))}
          </ul>
        )}
        <textarea
          ref={textareaRef}
          value={prompt.text}
          onChange={e => useDevRequestDrafts.getState().editPrompt(e.target.value)}
          aria-label="Prompt for Claude"
          spellCheck={false}
          className="input min-h-[14rem] flex-1 resize-none bg-surface font-mono text-meta leading-relaxed"
        />
      </div>
      <footer className="flex shrink-0 items-center gap-2 border-t border-line bg-surface px-3 py-2.5">
        <Button
          variant="ghost"
          size="sm"
          icon={<RotateCcw />}
          disabled={!prompt.edited || rows.length === 0}
          onClick={() => useDevRequestDrafts.getState().setPrompt(rows.map(r => r.id), buildClaudePrompt(rows))}
          title="Throw your edits away and build the prompt again from the picked requests"
        >
          Reset to generated
        </Button>
        <Button variant="primary" size="sm" icon={<Copy />} disabled={!prompt.text.trim()} onClick={() => void copy()} className="ml-auto">
          Copy prompt
        </Button>
      </footer>
    </>
  )
}
