import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { signIn, requestPasswordReset } from '../../../security/supabaseClient'

export function LoginPage() {
  const navigate = useNavigate()
  const [mode, setMode] = useState<'signin' | 'forgot'>('signin')
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState<string | null>(null)
  const [notice, setNotice]     = useState<string | null>(null)
  const [loading, setLoading]   = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const { error } = await signIn(email, password)

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    navigate('/')
  }

  async function handleForgotPassword(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setNotice(null)
    setLoading(true)

    const { error } = await requestPasswordReset(email)
    setLoading(false)

    if (error) {
      setError(error.message)
      return
    }

    setNotice('If an account exists for that email, a reset link has been sent.')
  }

  if (mode === 'forgot') {
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center px-4">
        <div className="w-full max-w-sm">
          <div className="flex flex-col items-center mb-8">
            <img src={`${import.meta.env.BASE_URL}logo.svg`} alt="Lasci's Board" className="w-12 h-12 mb-3" />
            <h1 className="text-xl font-semibold text-ink-900">Reset password</h1>
            <p className="text-sm text-ink-500 mt-1">We'll email you a reset link</p>
          </div>

          <form onSubmit={handleForgotPassword} className="card p-6 flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-ink-700">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                className="input"
              />
            </div>

            {error && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                {error}
              </p>
            )}
            {notice && (
              <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
                {notice}
              </p>
            )}

            <button type="submit" disabled={loading} className="btn-primary w-full mt-1">
              {loading ? 'Sending…' : 'Send reset link'}
            </button>

            <button
              type="button"
              onClick={() => { setMode('signin'); setError(null); setNotice(null) }}
              className="text-xs text-ink-500 hover:text-ink-800 min-h-[44px]"
            >
              ← Back to sign in
            </button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <img src={`${import.meta.env.BASE_URL}logo.svg`} alt="Lasci's Board" className="w-12 h-12 mb-3" />
          <h1 className="text-xl font-semibold text-ink-900">Lasci's Board</h1>
          <p className="text-sm text-ink-500 mt-1">Sign in to your board</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="card p-6 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-ink-700">Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              className="input"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-ink-700">Password</label>
              <button
                type="button"
                onClick={() => { setMode('forgot'); setError(null); setNotice(null) }}
                className="text-xs text-accent-600 hover:text-accent-700"
              >
                Forgot password?
              </button>
            </div>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              className="input"
            />
          </div>

          {error && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button type="submit" disabled={loading} className="btn-primary w-full mt-1">
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
