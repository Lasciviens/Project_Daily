import { lazy, Suspense, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { Button } from '../../../shared/ui'
import type { Task } from '../../todo/types'

// The sheet (and the AI code it needs) is its own chunk: Work's first download stays within its budget.
const WeekSheet = lazy(() => import('./WeekSheet'))

/** The "Write my week" button under "This week" and its sheet (WeekSheet: the text, built from the week's closed Work tasks, goals and notes). */
export function WriteWeek({ tasks }: { tasks: Task[] }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button size="sm" variant="ghost" icon={<Sparkles />} onClick={() => setOpen(true)} className="mt-2 -ml-2">Write my week</Button>
      {open && <Suspense fallback={null}><WeekSheet tasks={tasks} onClose={() => setOpen(false)} /></Suspense>}
    </>
  )
}
