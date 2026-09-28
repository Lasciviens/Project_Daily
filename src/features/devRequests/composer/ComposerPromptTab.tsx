import { useState } from 'react'
import { ChevronRight, Copy, RotateCcw, Sparkles } from 'lucide-react'
import { useDevRequestDrafts } from '../devRequestDraftStore'
import { descriptionPreview } from '../devRequestContext'
import { buildClaudePrompt } from '../devRequestPrompt'
import { useDevRequests } from '../hooks/useDevRequests'
import { toast, useUIStore } from '../../../app/store'
import { Button, EmptyState, cx } from '../../../shared/ui'

/**
 * The prompt for Claude, built from the requests picked in the drawer — and
 * editable here: your wording stays (it is saved with the drafts) until you
 * reset it to the generated one.
 */
export function ComposerPromptTab() {
  const prompt = useDevRequestDrafts(s => s.prompt)
  const { data: requests = [] } = useDevRequests()
  const [showList, setShowList] = useState(false)
  const rows = prompt.ids.map(id => requests.find(r => r.id === id)).filter(r => r != null)
  const missing = prompt.ids.length - rows.length

  function changeSelection() {
    useDevRequestDrafts.getState().setDrawer({ selecting: true, picked: rows.map(r => r.id) })
    if (!useUIStore.getState().isDevRequestsOpen) useUIStore.getState().toggleDevRequests()
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt.text)
      toast.success('Prompt copied')
    } catch {
      toast.error("Couldn't copy — select the text and copy it by hand")
    }
  }

  if (!prompt.text.trim() && prompt.ids.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col justify-center p-3">
        <EmptyState
          icon={<Sparkles />}
          title="No prompt yet"
          description="Pick requests in the Requests drawer, then Build prompt. You can edit the result here."
          action={<Button size="sm" onClick={changeSelection}>Pick requests</Button>}
        />
      </div>
    )
  }

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowList(v => !v)}
            aria-expanded={showList}
            className="-ml-1 flex min-h-[36px] min-w-0 flex-1 items-center gap-1 rounded-control px-1 text-left text-meta font-semibold text-fg-muted [@media(hover:hover)]:hover:text-fg [@media(pointer:coarse)]:min-h-[44px]"
          >
            <ChevronRight className={cx('h-4 w-4 shrink-0 transition-transform', showList && 'rotate-90')} aria-hidden />
            <span className="truncate">
              {rows.length} request{rows.length === 1 ? '' : 's'}{missing > 0 ? ` · ${missing} deleted` : ''}{prompt.edited ? ' · edited' : ''}
            </span>
          </button>
          <Button size="sm" variant="ghost" onClick={changeSelection}>Change</Button>
        </div>
        {showList && (
          <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto">
            {rows.map(r => (
              <li key={r.id} className="rounded-row border border-line bg-surface-2 px-2.5 py-1.5">
                <span className="block truncate text-body font-medium text-fg">{r.title}</span>
                {descriptionPreview(r.description) && <span className="line-clamp-2 block text-meta text-fg-muted">{descriptionPreview(r.description)}</span>}
              </li>
            ))}
          </ul>
        )}
        <textarea
          value={prompt.text}
          onChange={e => useDevRequestDrafts.getState().editPrompt(e.target.value)}
          aria-label="Prompt for Claude"
          spellCheck={false}
          className="input min-h-[14rem] flex-1 resize-none font-mono text-meta"
        />
      </div>
      <footer className="flex shrink-0 items-center gap-2 border-t border-line px-3 py-2.5">
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
