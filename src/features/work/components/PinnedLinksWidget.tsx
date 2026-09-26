import { useState } from 'react'
import { ExternalLink, Plus, X } from 'lucide-react'
import { Button } from '../../../shared/ui'
import { usePinnedLinks, useCreatePinnedLink, useDeletePinnedLink } from '../hooks/useWork'

const MAX_LINKS = 10

function isValidUrl(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://')
}

// Rendered inside WorkSidebar's rail card (no chrome of its own).
export default function PinnedLinksWidget() {
  const { data: links = [] } = usePinnedLinks()
  const createLink = useCreatePinnedLink()
  const deleteLink = useDeletePinnedLink()

  const [showAdd, setShowAdd] = useState(false)
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [urlError, setUrlError] = useState('')

  function resetForm() {
    setTitle('')
    setUrl('')
    setUrlError('')
    setShowAdd(false)
  }

  async function handleAdd() {
    const trimTitle = title.trim()
    const trimUrl = url.trim()
    if (!trimTitle || !trimUrl) { resetForm(); return }
    if (!isValidUrl(trimUrl)) {
      setUrlError('URL must start with http:// or https://')
      return
    }
    setUrlError('')
    try {
      await createLink.mutateAsync({ title: trimTitle, url: trimUrl })
      resetForm()
    } catch { /* toasted by the hook; keep the form so nothing typed is lost */ }
  }

  const canAdd = links.length < MAX_LINKS

  return (
    <div className="flex flex-col gap-2">
      {links.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {links.map(link => (
            <li key={link.id} className="group flex min-h-[40px] items-center rounded-full border border-line bg-surface-2 pl-3 [@media(pointer:coarse)]:min-h-[44px]">
              <a
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 whitespace-nowrap text-body font-medium text-fg-2 [@media(hover:hover)]:hover:text-accent-600"
              >
                {link.title} <ExternalLink aria-hidden className="h-3 w-3 text-fg-faint" />
              </a>
              <button
                type="button"
                onClick={() => deleteLink.mutate(link.id)}
                aria-label={`Remove ${link.title}`}
                className="grid min-h-[40px] min-w-[40px] place-items-center rounded-full text-fg-faint transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:hover:text-danger focus-visible:opacity-100 [@media(pointer:coarse)]:min-h-[44px] [@media(pointer:coarse)]:min-w-[44px]"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {showAdd ? (
        <div className="flex flex-col gap-2">
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') resetForm() }}
            placeholder="Title (e.g. Jira)"
            aria-label="Link title"
            className="input"
            autoFocus
          />
          <div className="flex flex-col gap-1">
            <input
              type="url"
              value={url}
              onChange={e => { setUrl(e.target.value); setUrlError('') }}
              onKeyDown={e => {
                if (e.key === 'Enter') void handleAdd()
                if (e.key === 'Escape') resetForm()
              }}
              placeholder="https://…"
              aria-label="Link URL"
              aria-invalid={urlError ? true : undefined}
              className={urlError ? 'input border-danger' : 'input'}
            />
            {urlError && <span className="px-1 text-meta text-danger">{urlError}</span>}
          </div>
          <div className="flex gap-2">
            <Button variant="primary" size="sm" className="flex-1" onClick={() => void handleAdd()} loading={createLink.isPending}>Add link</Button>
            <Button variant="ghost" size="sm" onClick={resetForm}>Cancel</Button>
          </div>
        </div>
      ) : canAdd ? (
        <Button variant="ghost" size="sm" icon={<Plus />} onClick={() => setShowAdd(true)} className="self-start">Add link</Button>
      ) : null}
    </div>
  )
}
