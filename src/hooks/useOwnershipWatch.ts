import { useEffect } from 'react'
import { loadVehicleOwnershipSnapshot } from '../services/vehicles'
import {
  ownershipChannel,
  refreshOwnershipViews,
} from '../services/ownershipChanges'
import { saveSenderTransfer } from '../services/transferSession'

export function useOwnershipWatch(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return
    let alive = true
    let generation = 0
    let previous: Map<string, string> | undefined
    async function check() {
      const request = ++generation
      try {
        const rows = await loadVehicleOwnershipSnapshot()
        if (!alive || request !== generation) return
        const next = new Map(
          rows.map((row) => [row.id, String(row.ownership_epoch)]),
        )
        const changed =
          previous &&
          (previous.size !== next.size ||
            [...previous].some(([id, epoch]) => next.get(id) !== epoch))
        if (previous) {
          for (const [id, epoch] of previous) {
            if (next.get(id) !== epoch) saveSenderTransfer(id, null)
          }
        }
        previous = next
        if (changed) refreshOwnershipViews()
      } catch {
        // Keep retrying; database authorization still applies to every mutation.
      }
    }
    const resume = () => {
      if (document.visibilityState === 'visible') void check()
    }
    let channel: BroadcastChannel | null = null
    try {
      if (typeof BroadcastChannel !== 'undefined')
        channel = new BroadcastChannel(ownershipChannel)
    } catch {
      // Polling and focus checks also work where cross-tab channels are blocked.
    }
    if (channel)
      channel.onmessage = (event) => {
        if (event.data === 'changed') refreshOwnershipViews()
      }
    void check()
    const timer = window.setInterval(resume, 5000)
    window.addEventListener('focus', resume)
    document.addEventListener('visibilitychange', resume)
    window.addEventListener('app:ownership-change', resume)
    return () => {
      alive = false
      generation++
      window.clearInterval(timer)
      window.removeEventListener('focus', resume)
      document.removeEventListener('visibilitychange', resume)
      window.removeEventListener('app:ownership-change', resume)
      channel?.close()
    }
  }, [enabled])
}
