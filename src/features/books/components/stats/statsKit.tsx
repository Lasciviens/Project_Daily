import { BookOpen } from 'lucide-react'
import { EmptyState } from '../../../../shared/ui'

/** Nothing has arrived from the Kobo yet. */
export function NoReadingData() {
  return <EmptyState icon={<BookOpen />} title="No reading synced yet"
    description="Reading time comes from KOReader on the Kobo. Install the Lasci's Board plugin and it arrives by itself whenever Wi-Fi comes on." />
}

