// Shared priority → visual mappings ('low'/'medium'/'high' is the same shape
// across tasks and project items). Was independently forked in ToDoItem.tsx,
// ItemRow.tsx and workMeta.ts.
export type Priority = 'low' | 'medium' | 'high'

export const PRIORITY_DOT_CLASS: Record<Priority, string> = {
  low:    'bg-ink-300',
  medium: 'bg-accent-400',
  high:   'bg-red-400 ring-1 ring-red-300',
}

export const PRIORITY_META: Record<Priority, { icon: string; cls: string; label: string }> = {
  high:   { icon: '▲', cls: 'text-red-500',    label: 'High'   },
  medium: { icon: '●', cls: 'text-accent-500', label: 'Medium' },
  low:    { icon: '▼', cls: 'text-ink-300',    label: 'Low'    },
}
