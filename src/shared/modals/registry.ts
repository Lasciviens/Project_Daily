import type { ComponentType, LazyExoticComponent } from 'react'
import { lazyWithReload } from '../utils/lazyWithReload'
import { ModalChunkFailed } from './ModalChunkFailed'
import type { EntityModalProps, ModalKind } from './types'

// kind → lazily loaded modal. One chunk per kind, so a page ships only the
// popups it actually opens. Each module exports a component taking exactly
// EntityModalProps<K> and loading its own data by id (see types.ts rules).
type Entry<K extends ModalKind> = LazyExoticComponent<ComponentType<EntityModalProps<K>>>
const L = <K extends ModalKind>(kind: K, load: () => Promise<ComponentType<EntityModalProps<K>>>): Entry<K> =>
  lazyWithReload(`modal-${kind}`, load, ModalChunkFailed)

export const MODAL_REGISTRY: { [K in ModalKind]?: Entry<K> } = {
  confirm: L('confirm', () => import('./ConfirmModal').then(m => m.ConfirmModal)),
}
