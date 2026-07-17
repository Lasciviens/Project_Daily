import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { supabase } from '../../../integrations/supabase/client'
import type { ProjectItem } from '../../projects/types'

// ─────────────────────────────────────────────────────────────────────────────
//  Cross-feature reads for Daily's hub cards (Projects / Work) — small,
//  focused queries that don't exist in the source features (Projects only
//  fetches per-project; Work only fetches per-section).
// ─────────────────────────────────────────────────────────────────────────────

export interface ActiveProjectItem extends ProjectItem {
  project?: { id: string; name: string } | null
}

// Active (open/in-progress) items across ALL projects, most actionable first:
// in_progress before open, then high→low priority. Capped — this is a "what
// should I move forward today" shortlist, not the full board.
export function useActiveProjectItems(limit = 6) {
  return useQuery({
    queryKey: ['projects', 'active-items', limit],
    queryFn: async (): Promise<ActiveProjectItem[]> => {
      const { data, error } = await supabase
        .from('project_items')
        .select('*, project:projects(id, name)')
        .in('status', ['open', 'in_progress'])
        .order('updated_at', { ascending: false })
        .limit(60)
      if (error) throw error
      const rank = { in_progress: 0, open: 1 } as Record<string, number>
      const prio = { high: 0, medium: 1, low: 2 } as Record<string, number>
      return (data ?? [])
        .sort((a, b) =>
          (rank[a.status] - rank[b.status]) ||
          (prio[a.priority] - prio[b.priority]))
        .slice(0, limit)
    },
    staleTime: 60_000,
  })
}

export function useSetProjectItemStatus() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action:         'set_project_item_status',
    successMessage: 'Updated ✓',
    mutationFn: async ({ id, status }: { id: string; status: ProjectItem['status'] }) => {
      const { error } = await supabase
        .from('project_items')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] }),
  })
}

// Work-domain tasks relevant to a given day: due that day, overdue-open, or
// undated-in-today's-section — mirrors Work's own board semantics without
// dragging the whole board query in.
export function useWorkTasksForDay(dateStr: string) {
  return useQuery({
    queryKey: ['tasks', 'work-day', dateStr],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tasks')
        .select('*')
        .eq('domain', 'work')
        .neq('status', 'cancelled')
        .or(`due_date.lte.${dateStr},due_date.is.null`)
        .order('due_date', { ascending: true, nullsFirst: false })
        .limit(30)
      if (error) throw error
      return data ?? []
    },
    staleTime: 30_000,
  })
}
