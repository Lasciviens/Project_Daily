import { lazyPart } from '../../../shared/utils/lazyPage'

// The Queue brings drag and drop (@dnd-kit) along: its own chunk, shown by
// ListDetail and loaded in idle time once Media is drawn (MediaPage).
export const LazyQueuePanel = lazyPart('media-queue', () => import('./QueuePanel').then(m => m.QueuePanel))
export const QUEUE_PART = [LazyQueuePanel] as const
