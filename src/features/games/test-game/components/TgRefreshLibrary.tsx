import { RefreshCw } from 'lucide-react'

export function TgRefreshIcon({ busy, size = 16 }: { busy: boolean; size?: number }) {
  return <RefreshCw aria-hidden size={size} strokeWidth={1.9} className={`shrink-0 ${busy ? 'animate-spin' : ''}`} />
}
