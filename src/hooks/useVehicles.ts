import { useEffect, useRef, useState } from 'react'
import { listVehicles } from '../services/vehicles'
import { authService } from '../services/auth'
import type { Vehicle } from '../types/vehicle'
import { useMaintenanceRefresh } from './useMaintenanceRefresh'
export function useVehicles() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [loading, setLoading] = useState(authService.available)
  const [error, setError] = useState('')
  const { revision, reload } = useMaintenanceRefresh(authService.available)
  const generation = useRef(0)
  useEffect(() => {
    const conceal = () => {
      generation.current++
      setVehicles([])
      setLoading(true)
    }
    window.addEventListener('app:ownership-change', conceal)
    return () => window.removeEventListener('app:ownership-change', conceal)
  }, [])
  useEffect(() => {
    if (!authService.available) return
    let alive = true
    const request = ++generation.current
    Promise.resolve()
      .then(() => {
        if (!alive) return []
        setLoading(true)
        setError('')
        return listVehicles()
      })
      .then((data) => {
        if (alive && request === generation.current) setVehicles(data)
      })
      .catch(() => {
        if (alive && request === generation.current) {
          setVehicles([])
          setError(
            'We couldn’t load your vehicles. Check your connection and try again.',
          )
        }
      })
      .finally(() => {
        if (alive && request === generation.current) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [revision])
  return { vehicles, loading, error, reload }
}
