import type { VehicleTransferInvitation } from '../types/vehicleTransfer'

const recipientKey = 'scsb:transfer:recipient'
const senderKey = (vehicleId: string) => `scsb:transfer:sender:${vehicleId}`
const validToken = (value: string) => /^[0-9a-f]{64}$/.test(value)

function read(key: string) {
  try {
    return sessionStorage.getItem(key)
  } catch {
    return null
  }
}
function write(key: string, value: string | null) {
  try {
    if (value === null) sessionStorage.removeItem(key)
    else sessionStorage.setItem(key, value)
  } catch {
    // Storage can be disabled; the current flow still works in memory.
  }
}

export function readRecipientTransferToken() {
  // A new fragment always takes precedence, even when it is malformed.
  if (window.location.hash) {
    const token = window.location.hash.slice(1)
    write(recipientKey, validToken(token) ? token : null)
    return validToken(token) ? token : ''
  }
  const token = read(recipientKey) ?? ''
  return validToken(token) ? token : ''
}

export function clearRecipientTransferToken(token: string) {
  // An old request must not clear a newer invitation opened in this tab.
  if (read(recipientKey) === token) write(recipientKey, null)
}

export function saveSenderTransfer(
  vehicleId: string,
  invite: VehicleTransferInvitation | null,
) {
  write(senderKey(vehicleId), invite ? JSON.stringify(invite) : null)
}

export function readSenderTransfer(
  vehicleId: string,
): VehicleTransferInvitation | null {
  try {
    const value = JSON.parse(read(senderKey(vehicleId)) ?? 'null')
    if (
      value &&
      typeof value.id === 'string' &&
      validToken(value.token) &&
      Date.parse(value.expires_at) > Date.now()
    )
      return value
  } catch {
    // Corrupt session data is treated as a missing invitation.
  }
  saveSenderTransfer(vehicleId, null)
  return null
}

export function clearTransferSession() {
  try {
    for (const key of Object.keys(sessionStorage)) {
      if (key.startsWith('scsb:transfer:')) sessionStorage.removeItem(key)
    }
  } catch {
    // No fallback to persistent storage.
  }
}
