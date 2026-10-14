import { useEffect, useRef, useState } from 'react'
import {
  listShopMaintenanceReminders,
  setShopMaintenanceReminderState,
} from '../services/shopReminders'
import type { ShopReminder } from '../types/shopReminder'

export function useShopReminders(
  enabled: boolean,
  revision: number,
  route: string,
) {
  const [reminders, setReminders] = useState<ShopReminder[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const generation = useRef<{ active: boolean } | null>(null)
  const pending = useRef(false)
  useEffect(() => {
    if (!enabled) return
    const request = { active: true }
    generation.current = request
    let alive = true
    const conceal = () => {
      alive = false
      request.active = false
      setReminders([])
    }
    window.addEventListener('app:ownership-change', conceal)
    void Promise.resolve().then(async () => {
      if (!alive) return
      setLoading(true)
      try {
        const rows = await listShopMaintenanceReminders()
        if (alive) {
          setReminders(rows)
          setError('')
          setBusy(null)
        }
      } catch {
        if (alive) {
          setReminders([])
          setError('Unable to load shop reminders.')
          setBusy(null)
        }
      } finally {
        if (alive) setLoading(false)
      }
    })
    return () => {
      alive = false
      request.active = false
      window.removeEventListener('app:ownership-change', conceal)
    }
  }, [enabled, revision, route])

  async function update(id: string, state: 'read' | 'dismissed') {
    if (pending.current) return
    pending.current = true
    const current = generation.current
    setBusy(id)
    try {
      await setShopMaintenanceReminderState(id, state)
      if (current?.active) {
        setReminders((rows) =>
          state === 'dismissed'
            ? rows.filter((row) => row.id !== id)
            : rows.map((row) =>
                row.id === id
                  ? { ...row, read_at: new Date().toISOString() }
                  : row,
              ),
        )
        setError('')
      }
    } catch {
      if (current?.active) {
        setReminders([])
        setError('Unable to update the reminder. Refresh and try again.')
      }
    } finally {
      pending.current = false
      if (current?.active) setBusy(null)
    }
  }
  return { reminders, loading, error, busy, update }
}
