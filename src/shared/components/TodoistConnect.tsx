import { useState } from 'react'
import { useTodoistStore } from '../../app/store'

export function TodoistConnect() {
  const { apiToken, setApiToken } = useTodoistStore()
  const [editing, setEditing]     = useState(false)
  const [input, setInput]         = useState('')

  if (apiToken && !editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="flex items-center gap-1.5 text-xs text-ink-500 hover:text-ink-700 transition-colors duration-150"
        title="Todoist connected — click to change"
      >
        <span className="w-2 h-2 rounded-full bg-red-400" />
        Todoist
      </button>
    )
  }

  if (editing || !apiToken) {
    return (
      <div className="flex items-center gap-1.5">
        <input
          type="password"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Todoist API token…"
          className="text-xs border border-ink-200 rounded px-2 py-1 w-36 focus:outline-none focus:border-accent-400"
          onKeyDown={e => {
            if (e.key === 'Enter' && input.trim()) {
              setApiToken(input.trim())
              setEditing(false)
              setInput('')
            }
            if (e.key === 'Escape') {
              setEditing(false)
              setInput('')
            }
          }}
          autoFocus
        />
        {apiToken && (
          <button
            onClick={() => { setApiToken(null); setEditing(false) }}
            className="text-xs text-red-400 hover:text-red-600 transition-colors duration-150"
          >
            Disconnect
          </button>
        )}
      </div>
    )
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="flex items-center gap-1.5 text-xs text-ink-400 hover:text-accent-600 transition-colors duration-150"
      title="Connect Todoist"
    >
      <span className="w-2 h-2 rounded-full bg-ink-200" />
      Todoist
    </button>
  )
}
