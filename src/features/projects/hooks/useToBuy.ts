import { useQueryClient } from '@tanstack/react-query'
import { qk } from '../../../shared/query'
import { useAddBatchToQuickList } from '../../shop/hooks/useQuickBatch'
import { updateEntry } from '../api/projectsApi'
import { sentChoice, sentData, toShopInput, type ToBuyRow } from '../toBuy'
import type { ProjectBlock } from '../types'

/**
 * "To buy → Shop": one tap puts a project table's To buy rows on the quick
 * list (duplicates skipped, one Undo) and moves them to "Ordered" in the same
 * action — a second tap finds nothing to send; Undo puts them back to To buy.
 */
export function useToBuyToShop() {
  const add = useAddBatchToQuickList()
  const qc = useQueryClient()
  return {
    send: (block: ProjectBlock, rows: ToBuyRow[], projectName: string) => {
      const choice = sentChoice(block)
      const refresh = () => { void qc.invalidateQueries({ queryKey: qk.projects.entries(block.project_id) }) }
      add.mutate({
        inputs: rows.map(r => toShopInput(r, projectName)),
        what: projectName,
        afterAdd: choice ? async () => {
          await Promise.all(rows.map(r => updateEntry(r.entryId, { data: sentData(r, choice) })))
          refresh()
          return async () => {
            await Promise.all(rows.map(r => updateEntry(r.entryId, { data: r.data })))
            refresh()
          }
        } : undefined,
      })
    },
    isPending: add.isPending,
  }
}
