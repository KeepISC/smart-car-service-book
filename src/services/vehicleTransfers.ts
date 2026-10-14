import { client } from './supabase'
import { notifyVehicleChange } from './vehicles'
import { announceOwnershipChange } from './ownershipChanges'
import { clearRecipientTransferToken } from './transferSession'
import type {
  VehicleTransferInvitation,
  VehicleTransferPreview,
  VehicleTransferStatus,
} from '../types/vehicleTransfer'

function requireToken(token: string) {
  if (!/^[0-9a-f]{64}$/.test(token))
    throw new Error('This transfer invitation is invalid.')
}

// Tokens are returned once. Only session-scoped storage may retain incomplete flows.
export async function createVehicleTransfer(
  vehicleId: string,
  expiresAt?: string,
): Promise<VehicleTransferInvitation> {
  if (expiresAt !== undefined && !Number.isFinite(Date.parse(expiresAt)))
    throw new Error('Enter a valid invitation expiry.')
  const { data, error } = await client().rpc('create_vehicle_transfer', {
    p_vehicle_id: vehicleId,
    p_expires_at: expiresAt ?? null,
  })
  if (error) throw error
  if (!data?.id || !data?.token || !data?.expires_at)
    throw new Error('The transfer invitation was not created.')
  return data as VehicleTransferInvitation
}

export async function previewVehicleTransfer(
  token: string,
): Promise<VehicleTransferPreview> {
  requireToken(token)
  const { data, error } = await client().rpc('preview_vehicle_transfer', {
    p_token: token,
  })
  if (error) throw error
  if (
    !data?.id ||
    !data?.vehicle?.id ||
    !data?.expires_at ||
    !Array.isArray(data.maintenance_records) ||
    !Array.isArray(data.maintenance_schedules)
  )
    throw new Error('The transfer invitation is unavailable.')
  return data as VehicleTransferPreview
}

export async function getVehicleTransferStatus(
  vehicleId: string,
  invitationId: string,
): Promise<VehicleTransferStatus> {
  const { data, error } = await client().rpc('vehicle_transfer_status', {
    p_vehicle_id: vehicleId,
    p_invitation_id: invitationId,
  })
  if (error) throw error
  if (!['pending', 'accepted', 'declined', 'revoked', 'expired'].includes(data))
    throw new Error('The invitation status is unavailable.')
  return data as VehicleTransferStatus
}

export async function acceptVehicleTransfer(token: string): Promise<string> {
  requireToken(token)
  const { data, error } = await client().rpc('accept_vehicle_transfer', {
    p_token: token,
  })
  if (error) throw error
  if (typeof data !== 'string' || !data)
    throw new Error('The vehicle transfer was not completed.')
  notifyVehicleChange(data)
  clearRecipientTransferToken(token)
  announceOwnershipChange()
  return data
}

export async function declineVehicleTransfer(token: string) {
  requireToken(token)
  const { error } = await client().rpc('decline_vehicle_transfer', {
    p_token: token,
  })
  if (error) throw error
  clearRecipientTransferToken(token)
}

export async function revokeVehicleTransfer(
  vehicleId: string,
  invitationId: string,
) {
  const { error } = await client().rpc('revoke_vehicle_transfer', {
    p_vehicle_id: vehicleId,
    p_invitation_id: invitationId,
  })
  if (error) throw error
}
