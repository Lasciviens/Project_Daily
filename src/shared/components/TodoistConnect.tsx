import { useState } from 'react'
import { useTodoistStore } from '../../app/store'
import { validateTodoistToken } from '../../features/todo/api/todoistApi'

export function TodoistConnect() {
  const { apiToken, setApiToken } = useTodoistStore()
  const [editing, setEditing]     = useState(false)
  const [input, setInput]         = useState('')
  const [validating, setValidating] = useState(false)
  const [error, setError]           = useState('')

  async function handleConnect(token: string) {
    setValidating(true)
    setError('')
    try {
      const ok = await validateTodoistToken(token)
      if (!ok) { setError('Invalid token'); return }
      setApiToken(token)
      setEditing(false)
      setInput('')
    } catch {
      setError('Could not reach Todoist')
    } finally {
      setValidating(false)
    }
  }

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
        <div className="flex flex-col gap-0.5">
          <input
            type="password"
            value={input}
            onChange={e => { setInput(e.target.value); setError('') }}
            placeholder="Todoist API token…"
            className={`text-xs border rounded px-2 py-1 w-36 focus:outline-none ${
              error ? 'border-red-400 focus:border-red-400' : 'border-ink-200 focus:border-accent-400'
            }`}
            onKeyDown={e => {
              if (e.key === 'Enter' && input.trim() && !validating) handleConnect(input.trim())
              if (e.key === 'Escape') { setEditing(false); setInput(''); setError('') }
            }}
            disabled={validating}
            autoFocus
          />
          {error && <p className="text-[10px] text-red-500">{error}</p>}
        </div>
        {validating && <span className="text-xs text-ink-400">…</span>}
        {apiToken && !validating && (
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
