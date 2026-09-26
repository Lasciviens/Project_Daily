import { createContext, useContext } from 'react'

// Stack depth of the modal being rendered, so a nested popup always sits above
// the one that opened it (z = modal base + depth × 10). Outside the host the
// depth is 0 and a controlled ModalShell uses the base layer.
export const ModalDepthContext = createContext(0)
export const useModalDepth = () => useContext(ModalDepthContext)
