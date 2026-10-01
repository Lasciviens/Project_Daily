import { useTestGameStore } from '../../testGameStore'
import { useIgdbBatch } from '../../../igdb/igdbBatchStore'

/** Opens the IGDB page on one game (looked up there, or its match changed). */
export function openIgdbFor(gameId: string) {
  useIgdbBatch.getState().set({ focusId: gameId, library: 'all' })
  useTestGameStore.getState().setSection('igdb')
}
