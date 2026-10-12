import { useEffect, useState } from 'react'
import { dateOnly } from '../services/maintenanceLogic'

export function useLocalDate(): string {
  const [today, setToday] = useState(dateOnly)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    function schedule() {
      clearTimeout(timer)
      const now = new Date()
      // Construct the next local midnight; a calendar day may be 23 or 25 hours.
      const midnight = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1,
      )
      timer = setTimeout(
        refresh,
        Math.max(1, midnight.getTime() - now.getTime()),
      )
    }
    function refresh() {
      setToday(dateOnly())
      schedule()
    }
    function resume() {
      if (document.visibilityState === 'visible') refresh()
    }
    schedule()
    window.addEventListener('focus', refresh)
    window.addEventListener('pageshow', refresh)
    document.addEventListener('visibilitychange', resume)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('focus', refresh)
      window.removeEventListener('pageshow', refresh)
      document.removeEventListener('visibilitychange', resume)
    }
  }, [])
  return today
}
