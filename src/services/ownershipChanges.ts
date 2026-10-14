import { invalidateVehicleReads } from './vehicles'
import { notifyMaintenanceChange } from './maintenanceChanges'

export const ownershipChannel = 'scsb:ownership-change'

export function refreshOwnershipViews() {
  invalidateVehicleReads()
  notifyMaintenanceChange()
  window.dispatchEvent(new Event('app:vehicle-change'))
  window.dispatchEvent(new Event('app:ownership-change'))
}

export function announceOwnershipChange() {
  refreshOwnershipViews()
  if (typeof BroadcastChannel === 'undefined') return
  try {
    const channel = new BroadcastChannel(ownershipChannel)
    try {
      // Same-origin signal only: no token, owner identity or vehicle data.
      channel.postMessage('changed')
    } finally {
      channel.close()
    }
  } catch {
    // A blocked channel must not turn a committed transfer into an error.
  }
}
