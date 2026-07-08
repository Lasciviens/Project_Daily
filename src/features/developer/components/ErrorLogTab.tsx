import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../../integrations/supabase/client'
import { requireUser } from '../../../shared/utils/requireUser'
import { toast } from '../../../app/store'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'

interface ErrorLog {
  id:         string
  message:    string
  context:    Record<string, unknown> | null
  created_at: string
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function useErrorLogs() {
  return useQuery<ErrorLog[]>({
    queryKey: ['error-logs'],
    queryFn: async () => {
      const cutoff = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
      const { data, error } = await supabase
        .from('app_error_logs')
        .select('id, message, context, created_at')
        .gte('created_at', cutoff)
        .order('created_at', { ascending: false })
        .limit(100)
      if (error) throw error
      return (data ?? []) as ErrorLog[]
    },
    staleTime: 30_000,
  })
}

function useClearLogs() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action:         'clear_error_logs',
    successMessage: 'Logs cleared ✓',
    mutationFn: async () => {
      const user = await requireUser()
      const { error } = await supabase.from('app_error_logs').delete().eq('user_id', user.id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['error-logs'] }),
  })
}

export function ErrorLogTab() {
  const { data: logs = [], isLoading, error, refetch } = useErrorLogs()
  const clearLogs = useClearLogs()
  const [expanded, setExpanded] = useState<string | null>(null)

  function copyText(text: string) {
    navigator.clipboard.writeText(text)
      .then(() => toast.success('Copied ✓'))
      .catch(() => toast.error('Copy failed'))
  }

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-ink-400">Last 2 days · {logs.length} entr{logs.length === 1 ? 'y' : 'ies'}</p>
        <div className="flex items-center gap-2">
          <button
            onClick={async () => {
              const tid = toast.loading('Refreshing…')
              try {
                await refetch()
                toast.dismiss(tid)
                toast.success('Refreshed ✓')
              } catch (err) {
                toast.dismiss(tid)
                toast.error((err as Error).message ?? 'Refresh failed')
              }
            }}
            className="text-xs px-3 py-2 rounded-lg border border-ink-200 text-ink-600 hover:border-ink-400 transition-colors duration-150 min-h-[44px]"
          >
            ↻ Refresh
          </button>
          {logs.length > 0 && (
            <button
              onClick={() => clearLogs.mutate()}
              disabled={clearLogs.isPending}
              className="text-xs px-3 py-2 rounded-lg border border-red-200 text-red-500 hover:border-red-400 transition-colors duration-150 min-h-[44px] disabled:opacity-50"
            >
              Clear all
            </button>
          )}
        </div>
      </div>

      {isLoading && <p className="text-sm text-ink-400">Loading…</p>}

      {error && (
        <div className="text-xs text-red-500 bg-red-50 border border-red-200 rounded-xl p-3">
          ⚠ {(error as Error).message}
        </div>
      )}

      {!isLoading && logs.length === 0 && (
        <div className="text-center py-16 text-ink-400">
          <div className="text-3xl mb-3">✓</div>
          <p className="text-sm">No errors in the last 2 days</p>
        </div>
      )}

      <div className="space-y-2">
        {logs.map(log => {
          const isOpen = expanded === log.id
          const hasContext = log.context && Object.keys(log.context).length > 0
          return (
            <div
              key={log.id}
              className="rounded-xl border border-ink-100 bg-white overflow-hidden"
            >
              <div className="flex items-start gap-3 p-3">
                <span className="w-2 h-2 rounded-full bg-red-400 flex-shrink-0 mt-1.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-ink-900 break-words">{log.message}</p>
                  <p className="text-[10px] text-ink-400 mt-0.5">{fmtDate(log.created_at)}</p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => copyText(log.message)}
                    title="Copy message"
                    className="text-[10px] px-2 py-1.5 rounded-lg text-ink-400 hover:text-ink-700 hover:bg-ink-100 transition-colors duration-150 min-h-[44px] min-w-[44px] flex items-center justify-center"
                  >
                    ⎘
                  </button>
                  {hasContext && (
                    <button
                      onClick={() => setExpanded(isOpen ? null : log.id)}
                      className="text-[10px] px-2 py-1.5 rounded-lg text-ink-400 hover:text-ink-700 hover:bg-ink-100 transition-colors duration-150 min-h-[44px] min-w-[44px] flex items-center justify-center"
                    >
                      {isOpen ? '▲' : '▼'}
                    </button>
                  )}
                </div>
              </div>
              {isOpen && hasContext && (
                <div className="border-t border-ink-100 bg-ink-50 px-3 py-2">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-semibold text-ink-400 uppercase tracking-wide">Context</span>
                    <button
                      onClick={() => copyText(JSON.stringify(log.context, null, 2))}
                      className="text-[10px] text-ink-400 hover:text-ink-700 min-h-[44px] px-2 flex items-center"
                    >
                      Copy JSON
                    </button>
                  </div>
                  <pre className="text-xs text-ink-700 overflow-x-auto whitespace-pre-wrap break-words">
                    {JSON.stringify(log.context, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}
