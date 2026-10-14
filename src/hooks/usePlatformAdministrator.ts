import { useEffect, useState } from 'react'
import { authService } from '../services/auth'
import { isPlatformAdministrator } from '../services/platformAdministration'

// Capability discovery only: this hides navigation. Every platform RPC is
// authorized again by the server, so a stale or forged result grants nothing.
export function usePlatformAdministrator(enabled: boolean) {
  const [value, setValue] = useState(false)
  useEffect(() => {
    if (!enabled || !authService.available) return
    let alive = true
    isPlatformAdministrator()
      .then((result) => {
        if (alive) setValue(result)
      })
      .catch(() => {
        if (alive) setValue(false)
      })
    return () => {
      alive = false
    }
  }, [enabled])
  return enabled && value
}
