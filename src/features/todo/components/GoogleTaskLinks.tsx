import { MenuItem } from '@headlessui/react'
import { ExternalLink, Mail } from 'lucide-react'
import { googleTaskLinks, type GoogleTaskLink } from '../api/googleTasksRules'
import type { Task } from '../types'

// A Google task's way back to Google: the task in Google Tasks
// (webViewLink) and Google's own links on it — a task made from a Gmail
// message links to that email. Shown in a task row's ⋯ menu (phone) and its
// hover strip (desktop).

function linksOf(task: Task): GoogleTaskLink[] {
  const own = task.google_web_view_link && /^https?:\/\//i.test(task.google_web_view_link)
    ? [{ label: 'Open in Google Tasks', url: task.google_web_view_link }]
    : []
  return [...own, ...googleTaskLinks(task.google_links)]
}

const iconFor = (l: GoogleTaskLink) => (l.label === 'Open email' ? <Mail aria-hidden /> : <ExternalLink aria-hidden />)

/** Items for the row's ⋯ menu. */
export function GoogleTaskLinkMenuItems({ task }: { task: Task }) {
  return linksOf(task).map(l => (
    <MenuItem key={l.url}>
      <a href={l.url} target="_blank" rel="noreferrer" className="menu-item [&_svg]:h-4 [&_svg]:w-4">
        {iconFor(l)} {l.label}
      </a>
    </MenuItem>
  ))
}

/** Icon links for the desktop hover strip. */
export function GoogleTaskLinkButtons({ task }: { task: Task }) {
  return linksOf(task).map(l => (
    <a
      key={l.url} href={l.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
      title={l.label} aria-label={l.label}
      className="grid h-7 w-7 place-items-center rounded-control text-fg-faint transition-colors hover:bg-surface-hover hover:text-fg [&_svg]:h-3.5 [&_svg]:w-3.5"
    >{iconFor(l)}</a>
  ))
}
