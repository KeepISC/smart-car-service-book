import { useCallback, useEffect, useState } from 'react'

export function useMaintenanceRefresh(enabled = true) {
  const [revision, setRevision] = useState(0)
  const reload = useCallback(() => setRevision((value) => value + 1), [])
  useEffect(() => {
    if (!enabled) return
    let timer: ReturnType<typeof setTimeout> | undefined
    // Focus and visibility events often arrive together when returning to a tab.
    const refresh = () => {
      clearTimeout(timer)
      timer = setTimeout(reload, 0)
    }
    const resume = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', resume)
    window.addEventListener('app:maintenance-change', refresh)
    window.addEventListener('app:vehicle-change', refresh)
    window.addEventListener('app:data-change', refresh)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', resume)
      window.removeEventListener('app:maintenance-change', refresh)
      window.removeEventListener('app:vehicle-change', refresh)
      window.removeEventListener('app:data-change', refresh)
    }
  }, [enabled, reload])
  return { revision, reload }
}
