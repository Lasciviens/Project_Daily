import { useEffect } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Router } from './router'
import { applyTheme } from '../shared/components/ThemeSwitcher'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      retry: 1,
    },
  },
})

export function Providers() {
  useEffect(() => {
    const saved = localStorage.getItem('accent-theme') ?? 'orange'
    applyTheme(saved)
  }, [])

  return (
    <QueryClientProvider client={queryClient}>
      <Router />
    </QueryClientProvider>
  )
}
