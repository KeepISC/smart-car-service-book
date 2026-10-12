import { useCallback, useEffect, useState } from 'react'
import { listVehicles } from '../services/vehicles'
import { authService } from '../services/auth'
import type { Vehicle } from '../types/vehicle'
export function useVehicles() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [loading, setLoading] = useState(authService.available)
  const [error, setError] = useState('')
  const reload = useCallback(async () => {
    if (!authService.available) return
    setLoading(true)
    setError('')
    try {
      setVehicles(await listVehicles())
    } catch {
      setError(
        'We couldn’t load your vehicles. Check your connection and try again.',
      )
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    if (!authService.available) return
    let alive = true
    listVehicles()
      .then((data) => {
        if (alive) setVehicles(data)
      })
      .catch(() => {
        if (alive)
          setError(
            'We couldn’t load your vehicles. Check your connection and try again.',
          )
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])
  return { vehicles, loading, error, reload }
}
