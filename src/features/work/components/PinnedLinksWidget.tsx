import { useState } from 'react'
import { toast } from '../../../app/store'
import { usePinnedLinks, useCreatePinnedLink, useDeletePinnedLink } from '../hooks/useWork'

const MAX_LINKS = 10

function isValidUrl(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://')
}

// bare = no own header label — rendered inside WorkSidebar's RailSection
export default function PinnedLinksWidget({ bare }: { bare?: boolean } = {}) {
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
    const tid = toast.loading('Adding link…')
    try {
      await createLink.mutateAsync({ title: trimTitle, url: trimUrl })
      toast.dismiss(tid)
      toast.success('Link added ✓')
      resetForm()
    } catch (err) {
      toast.dismiss(tid)
      toast.error((err as Error).message ?? 'Failed to add link')
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteLink.mutateAsync(id)
    } catch (err) {
      toast.error((err as Error).message ?? 'Failed to remove link')
    }
  }

  const canAdd = links.length < MAX_LINKS

  return (
    <div className="flex flex-col gap-2">
      {/* Header */}
      {!bare && (
        <span className="text-[10px] font-semibold tracking-widest uppercase text-ink-400">
          Pinned Links
        </span>
      )}

      {/* Link chips */}
      {links.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {links.map(link => (
            <div
              key={link.id}
              className="group flex items-center gap-1.5 rounded-full bg-ink-100 hover:bg-ink-200 transition px-3 py-1.5 min-h-[44px]"
            >
              <a
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-ink-700 hover:text-ink-900 leading-none whitespace-nowrap"
              >
                {link.title} ↗
              </a>
              <button
                onClick={() => handleDelete(link.id)}
                aria-label={`Remove ${link.title}`}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center text-ink-300 hover:text-ink-600 leading-none text-base opacity-100 md:opacity-0 md:group-hover:opacity-100 transition ml-0.5"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add form */}
      {showAdd ? (
        <div className="flex flex-col gap-2 mt-1">
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') resetForm() }}
            placeholder="Jira"
            className="min-h-[44px] bg-cream-50 rounded-xl px-3 text-sm text-ink-900 placeholder:text-ink-300 outline-none focus:ring-1 focus:ring-ink-200 transition"
            autoFocus
          />
          <div className="flex flex-col gap-1">
            <input
              type="url"
              value={url}
              onChange={e => { setUrl(e.target.value); setUrlError('') }}
              onKeyDown={e => {
                if (e.key === 'Enter') handleAdd()
                if (e.key === 'Escape') resetForm()
              }}
              placeholder="https://…"
              className={`min-h-[44px] bg-cream-50 rounded-xl px-3 text-sm text-ink-900 placeholder:text-ink-300 outline-none focus:ring-1 transition ${
                urlError ? 'ring-1 ring-red-400 focus:ring-red-400' : 'focus:ring-ink-200'
              }`}
            />
            {urlError && (
              <span className="text-xs text-red-500 px-1">{urlError}</span>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleAdd}
              disabled={createLink.isPending}
              className="min-h-[44px] flex-1 bg-ink-950 text-cream-50 rounded-xl text-sm font-medium hover:bg-ink-700 transition disabled:opacity-50"
            >
              Add
            </button>
            <button
              onClick={resetForm}
              className="min-h-[44px] px-4 rounded-xl text-sm text-ink-500 hover:text-ink-700 transition"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : canAdd ? (
        <button
          onClick={() => setShowAdd(true)}
          className="min-h-[44px] text-left text-sm text-ink-400 hover:text-ink-600 transition"
        >
          + Add link
        </button>
      ) : null}
    </div>
  )
}
