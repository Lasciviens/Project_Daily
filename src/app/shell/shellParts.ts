import { lazyPart } from '../../shared/utils/lazyPage'

// What the shell opens on demand, kept out of the first download of every
// page: the ⌘K palette's body, Ask AI and the Requests drawer. AppShell loads
// their code at the first quiet moment after start, before the other pages,
// and then mounts the two drawers closed, as they always were.
export const CommandPalette = lazyPart('command-palette', () => import('../../shared/components/CommandPalette').then(m => m.CommandPalette))
export const AIPanel = lazyPart('ai-panel', () => import('../../features/ai/components/AIPanel').then(m => m.AIPanel))
export const DevRequestsDrawer = lazyPart('dev-requests-drawer', () => import('../../features/devRequests/components/DevRequestsDrawer').then(m => m.DevRequestsDrawer))

export const SHELL_PARTS = [CommandPalette, AIPanel, DevRequestsDrawer]
