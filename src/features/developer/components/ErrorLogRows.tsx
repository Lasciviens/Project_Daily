import { useState } from 'react'
import { ChevronDown, Copy } from 'lucide-react'
import { toast } from '../../../app/store'
import { Button, Card, IconButton, ToneDot, cx, useBoardStep } from '../../../shared/ui'
import type { ErrorLog } from '../hooks/useLogs'
import { formatDateTime } from '../../../shared/utils/dateFormat'
import { agoLabel } from './activityLogMeta'
import { DETAIL_PANE_FROM } from '../developerBoards'

// Rows and the detail pane of the error log (ErrorLogTab): a row opens its
// context in place on phones and tablets, and picks the error for the pane
// beside the list on wider pages.

function fmtDate(iso: string): string {
  return formatDateTime(iso)
}

function copyText(text: string) {
  navigator.clipboard.writeText(text)
    .then(() => toast.success('Copied'))
    .catch(() => toast.error('Copy failed'))
}

const hasContext = (log: ErrorLog) => !!log.context && Object.keys(log.context).length > 0

function ContextBlock({ log }: { log: ErrorLog }) {
  return (
    <>
      <div className="mb-1 flex items-center justify-between">
        <span className="section-label">Context</span>
        <Button size="sm" variant="ghost" icon={<Copy />} onClick={() => copyText(JSON.stringify(log.context, null, 2))}>Copy JSON</Button>
      </div>
      <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-meta text-fg-2">
        {JSON.stringify(log.context, null, 2)}
      </pre>
    </>
  )
}

/** Phones and tablets: the row copies its message and opens its context in place. */
function InlineRow({ log, open, onToggle }: { log: ErrorLog; open: boolean; onToggle: () => void }) {
  return (
    <li>
      <div className="flex items-start gap-3 py-2 pl-4 pr-2">
        <ToneDot tone="danger" className="mt-2" />
        <div className="min-w-0 flex-1 py-1">
          <p className="break-words text-body text-fg">{log.message}</p>
          <p className="mt-0.5 text-meta tabular-nums text-fg-muted">{fmtDate(log.created_at)}</p>
        </div>
        <div className="flex shrink-0 items-center">
          <IconButton label="Copy message" onClick={() => copyText(log.message)}><Copy /></IconButton>
          {hasContext(log) && (
            <IconButton label={open ? 'Hide context' : 'Show context'} aria-expanded={open} onClick={onToggle}>
              <ChevronDown className={cx('transition-transform', open && 'rotate-180')} />
            </IconButton>
          )}
        </div>
      </div>
      {open && hasContext(log) && (
        <div className="border-t border-line bg-surface-2 px-4 py-2"><ContextBlock log={log} /></div>
      )}
    </li>
  )
}

/** Wider pages: the whole row picks the error for the pane. */
function PickRow({ log, selected, onPick }: { log: ErrorLog; selected: boolean; onPick: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onPick}
        aria-current={selected ? 'true' : undefined}
        className={cx(
          'flex min-h-[44px] w-full items-start gap-3 px-4 py-2.5 text-left transition-colors',
          selected ? 'bg-accent-50' : '[@media(hover:hover)]:hover:bg-surface-hover',
        )}
      >
        <ToneDot tone="danger" className="mt-1.5" />
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 break-words text-body text-fg">{log.message}</span>
          <span className="mt-0.5 block text-meta tabular-nums text-fg-muted">{fmtDate(log.created_at)}</span>
        </span>
      </button>
    </li>
  )
}

export function ErrorList({ logs, picked, onPick }: { logs: ErrorLog[]; picked: string | null; onPick: (id: string) => void }) {
  const paneMode = useBoardStep() >= DETAIL_PANE_FROM
  const [expanded, setExpanded] = useState<string | null>(null)
  return (
    <ul className="card divide-y divide-line overflow-hidden">
      {logs.map(log => paneMode
        ? <PickRow key={log.id} log={log} selected={picked === log.id} onPick={() => onPick(log.id)} />
        : <InlineRow key={log.id} log={log} open={expanded === log.id} onToggle={() => setExpanded(e => e === log.id ? null : log.id)} />)}
    </ul>
  )
}

export function ErrorDetail({ log }: { log: ErrorLog }) {
  return (
    <Card aria-label="Error details" className="flex max-h-[calc(100dvh-7rem)] flex-col gap-3 overflow-y-auto">
      <div className="flex items-start gap-3">
        <ToneDot tone="danger" className="mt-1.5" />
        <div className="min-w-0 flex-1">
          <p className="break-words text-body font-medium text-fg">{log.message}</p>
          <p className="mt-0.5 text-meta tabular-nums text-fg-muted">{fmtDate(log.created_at)} · {agoLabel(log.created_at)}</p>
        </div>
        <IconButton label="Copy message" onClick={() => copyText(log.message)}><Copy /></IconButton>
      </div>
      <div className="border-t border-line pt-3">
        {hasContext(log) ? <ContextBlock log={log} /> : <p className="text-meta text-fg-muted">No context was recorded with this error.</p>}
      </div>
    </Card>
  )
}
