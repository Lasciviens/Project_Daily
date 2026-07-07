import { Navigate } from 'react-router-dom'
import { useAuth } from '../shared/hooks/useAuth'

interface Props {
  children: React.ReactNode
}

export function SessionGuard({ children }: Props) {
  const { session, loading } = useAuth()

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
