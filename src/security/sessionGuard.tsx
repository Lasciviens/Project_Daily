import { Navigate } from 'react-router-dom'
import { useAuth } from '../shared/hooks/useAuth'

interface Props {
  children: React.ReactNode
}

export function SessionGuard({ children }: Props) {
  const { session, loading, likelySignedIn } = useAuth()

  // A browser that holds a sign-in gets the app at once; the session read (a moment, or a token refresh
  // over the network after an hour away) no longer holds the first screen. Nothing private shows on the
  // hint alone: the database answers only a real session, and the kept answers are this account's own.
  if (loading && likelySignedIn) return <>{children}</>

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-cream-100">
        <div className="w-8 h-8 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!session) return <Navigate to="/login" replace />

  return <>{children}</>
}
