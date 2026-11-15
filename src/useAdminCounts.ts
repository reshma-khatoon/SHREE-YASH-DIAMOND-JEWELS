import { useCallback, useEffect, useState } from 'react'
import { AdminRequestError, getAdminCounts, type AdminCounts } from './adminApi'
import { clearRejectedSession } from './adminSession'

export function useAdminCounts(token: string) {
  const [version, setVersion] = useState(0)
  const [state, setState] = useState<{ token: string; counts: AdminCounts | null; error: string }>({
    token: '', counts: null, error: '',
  })
  const refresh = useCallback(() => setVersion((value) => value + 1), [])

  useEffect(() => {
    if (!token) return
    let active = true
    let inFlight = false
    let timer: number | undefined

    async function load() {
      if (!active || inFlight) return
      inFlight = true
      if (timer !== undefined) window.clearTimeout(timer)
      try {
        const counts = await getAdminCounts(token)
        if (active) setState({ token, counts, error: '' })
      } catch (error) {
        if (!active) return
        if (error instanceof AdminRequestError && error.status === 401) {
          setState({ token, counts: null, error: error.message })
          try {
            await clearRejectedSession(token)
          } catch (clearError) {
            if (active) setState({ token, counts: null, error: clearError instanceof Error ? clearError.message : 'Could not clear the session.' })
          }
        } else {
          const message = error instanceof Error ? error.message : 'Could not load dashboard counts.'
          setState((current) => ({ token, counts: current.token === token ? current.counts : null, error: message }))
        }
      } finally {
        inFlight = false
        if (active) timer = window.setTimeout(() => void load(), 15000)
      }
    }

    const onVisible = () => {
      if (document.visibilityState === 'visible') void load()
    }
    setState({ token, counts: null, error: '' })
    void load()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      active = false
      if (timer !== undefined) window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [token, version])

  return {
    counts: token && state.token === token ? state.counts : null,
    error: token && state.token === token ? state.error : '',
    refresh,
  }
}
