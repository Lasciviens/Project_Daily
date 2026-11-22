import { MessageSquarePlus, Trash2 } from 'lucide-react'
import { EmptyState, IconButton, Skeleton, Truncate, MetaLine } from '../../../shared/ui'
import { formatDateTime } from '../../../shared/utils/dateFormat'
import { formatUsd } from '../claude/ledgerRules'
import type { ConversationListItem } from './chatApi'
import { Button } from '../../../shared/ui'

// The list of the owner's chats: a tap continues one (its messages are read back from the database, as they were sent).

export function ChatHistory({ items, loading, activeId, onOpen, onNew, onDelete }: {
  items: ConversationListItem[]
  loading: boolean
  activeId: string | null
  onOpen: (id: string) => void
  onNew: () => void
  onDelete: (item: ConversationListItem) => void
}) {
  if (loading) return <div className="flex flex-col gap-2 p-4">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} rounded="rounded-row" className="h-12" />)}</div>
  if (!items.length) {
    return <div className="p-4"><EmptyState bordered icon={<MessageSquarePlus />} title="No chats yet" description="Every chat is kept here, so you can come back to it." action={<Button variant="primary" onClick={onNew}>New chat</Button>} /></div>
  }
  return (
    <ul className="divide-y divide-line">
      {items.map(c => (
        <li key={c.id} className={`flex items-center pr-2 transition-colors [@media(hover:hover)]:hover:bg-surface-hover ${c.id === activeId ? 'bg-accent-50' : ''}`}>
          <button type="button" onClick={() => onOpen(c.id)} aria-current={c.id === activeId ? 'true' : undefined}
            className="flex min-w-0 flex-1 flex-col items-start gap-0.5 px-4 py-2.5 text-left">
            <Truncate as="span" className="w-full text-body font-medium text-fg">{c.title}</Truncate>
            <MetaLine as="span" className="text-meta tabular-nums text-fg-muted" items={[formatDateTime(c.updatedAt), c.costUsd > 0 && formatUsd(c.costUsd), c.status !== 'open' && 'full']} />
          </button>
          <IconButton label={`Delete chat ${c.title}`} onClick={() => onDelete(c)}><Trash2 strokeWidth={1.9} aria-hidden /></IconButton>
        </li>
      ))}
    </ul>
  )
}
