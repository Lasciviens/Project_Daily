import { Suspense, type ComponentType } from 'react'
import { useModalStore } from './modalStore'
import { MODAL_REGISTRY } from './registry'
import { ModalDepthContext } from './ModalLayer'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { logError } from '../utils/logError'
import type { EntityModalProps, ModalKind } from './types'

/**
 * Renders the entity-modal stack. Mounted once per app shell (Layout, and any
 * full-screen route outside it). Each entry has a stable key, mounts once and
 * unmounts on close.
 */
export function ModalHost() {
  const stack = useModalStore(s => s.stack)
  const close = useModalStore(s => s.close)
  return (
    <>
      {stack.map(({ key, request }, depth) => {
        const C = MODAL_REGISTRY[request.kind] as ComponentType<EntityModalProps<ModalKind>> | undefined
        if (!C) {
          void logError(`No modal registered for kind "${request.kind}"`, { action: 'modal_host' })
          return null
        }
        return (
          <ModalDepthContext.Provider key={key} value={depth}>
            <ErrorBoundary label="This popup" action={`modal_${request.kind}`}>
              <Suspense fallback={null}>
                <C request={request as never} onClose={() => close(key)} />
              </Suspense>
            </ErrorBoundary>
          </ModalDepthContext.Provider>
        )
      })}
    </>
  )
}
