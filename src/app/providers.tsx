import { useEffect } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { GoogleOAuthProvider } from '@react-oauth/google'
import { Router } from './router'
import { applyStoredTheme } from './store'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      retry: 1,
    },
  },
})

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined

export function Providers() {
  useEffect(() => { applyStoredTheme() }, [])

  const app = (
    <QueryClientProvider client={queryClient}>
      <Router />
    </QueryClientProvider>
  )

  // GoogleOAuthProvider only wraps when client ID is configured
  if (!GOOGLE_CLIENT_ID) return app

  return (
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      {app}
    </GoogleOAuthProvider>
  )
}
