import { client } from './supabase'
import { isServiceHistoryEnabled } from '../config/features'
import { notifyMaintenanceChange } from './maintenanceChanges'
import type {
  RepairShop,
  RepairShopStaff,
  ShopServiceVisitInput,
  ShopStaffRole,
  ShopVehicle,
  VehicleShopAuthorization,
  ShopConnectionInvitation,
  ShopConnectionInvitationStatus,
  ShopConnectionPreview,
  RepairShopDirectoryPage,
  VehicleShopDataSharing,
} from '../types/repairShop'

async function call(name: string, parameters?: Record<string, unknown>) {
  const { data, error } = await client().rpc(name, parameters)
  // Preserve authorization and serialization failures; do not retry stale approvals.
  if (error) throw error
  return data
}

function requireId(data: unknown): string {
  if (typeof data !== 'string' || !data)
    throw new Error('The shop operation was not completed.')
  return data
}

function requireList<T>(data: unknown): T[] {
  if (!Array.isArray(data)) throw new Error('The shop records are unavailable.')
  return data as T[]
}

export async function createRepairShop(name: string): Promise<string> {
  const trimmed = name.trim()
  if (!trimmed || trimmed.length > 120)
    throw new Error('Shop name must contain 1 to 120 characters.')
  return requireId(await call('create_repair_shop', { p_name: trimmed }))
}

export async function listRepairShops(): Promise<RepairShop[]> {
  return requireList(await call('list_repair_shops'))
}

export async function requestRepairShopMembership(shopId: string) {
  await call('request_repair_shop_membership', { p_shop_id: shopId })
}

export async function listRepairShopStaff(
  shopId: string,
): Promise<RepairShopStaff[]> {
  return requireList(
    await call('list_repair_shop_staff', { p_shop_id: shopId }),
  )
}

// The target UUID identifies a self-requested member; it never chooses the actor.
export async function setRepairShopStaff(
  shopId: string,
  memberId: string,
  role: ShopStaffRole | null,
) {
  if (role !== null && role !== 'admin' && role !== 'mechanic')
    throw new Error('Choose admin, mechanic or removal.')
  await call('set_repair_shop_staff', {
    p_shop_id: shopId,
    p_member_id: memberId,
    p_role: role,
  })
}

export async function requestVehicleShopAuthorization(
  vehicleId: string,
  shopId: string,
) {
  return requireId(
    await call('request_vehicle_shop_authorization', {
      p_vehicle_id: vehicleId,
      p_shop_id: shopId,
    }),
  )
}

export async function approveVehicleShopAuthorization(
  vehicleId: string,
  authorizationId: string,
  canCreateRecords: boolean,
) {
  if (typeof canCreateRecords !== 'boolean')
    throw new Error('Choose record creation permission.')
  await call('approve_vehicle_shop_authorization', {
    p_vehicle_id: vehicleId,
    p_authorization_id: authorizationId,
    p_can_create_records: canCreateRecords,
  })
}

export async function revokeVehicleShopAuthorization(
  vehicleId: string,
  authorizationId: string,
) {
  await call('revoke_vehicle_shop_authorization', {
    p_vehicle_id: vehicleId,
    p_authorization_id: authorizationId,
  })
}

export async function listVehicleShopAuthorizations(
  vehicleId: string,
): Promise<VehicleShopAuthorization[]> {
  return requireList(
    await call('list_vehicle_shop_authorizations', { p_vehicle_id: vehicleId }),
  )
}

export async function listRepairShopAuthorizations(
  shopId: string,
): Promise<VehicleShopAuthorization[]> {
  return requireList(
    await call('list_repair_shop_authorizations', { p_shop_id: shopId }),
  )
}

export async function getRepairShopVehicle(
  shopId: string,
  vehicleId: string,
): Promise<ShopVehicle> {
  const data = await call('get_repair_shop_vehicle', {
    p_shop_id: shopId,
    p_vehicle_id: vehicleId,
  })
  if (
    !data?.vehicle?.id ||
    !Array.isArray(data.maintenance_schedules) ||
    !Array.isArray(data.maintenance_records)
  )
    throw new Error('The customer vehicle is unavailable.')
  return data as ShopVehicle
}

export async function createRepairShopServiceVisit(
  shopId: string,
  vehicleId: string,
  input: ShopServiceVisitInput,
): Promise<string> {
  if (!isServiceHistoryEnabled())
    throw new Error('Service history is not enabled.')
  const id = requireId(
    await call('create_repair_shop_service_visit', {
      p_shop_id: shopId,
      p_vehicle_id: vehicleId,
      p_payload: input,
    }),
  )
  notifyMaintenanceChange()
  return id
}

export async function resolveVehicleShopRequest(
  vehicleId: string,
  authorizationId: string,
  outcome: 'declined' | 'cancelled' | 'expired',
) {
  if (!['declined', 'cancelled', 'expired'].includes(outcome))
    throw new Error('Choose decline, cancel or expiry.')
  await call('resolve_vehicle_shop_request', {
    p_vehicle_id: vehicleId,
    p_authorization_id: authorizationId,
    p_outcome: outcome,
  })
}

function requireConnectionToken(token: string) {
  if (!/^[0-9a-f]{64}$/.test(token))
    throw new Error('The shop connection invitation is invalid.')
}

export async function createRepairShopConnectionInvitation(
  shopId: string,
  expiresAt?: string,
): Promise<ShopConnectionInvitation> {
  if (expiresAt !== undefined && !Number.isFinite(Date.parse(expiresAt)))
    throw new Error('Enter a valid invitation expiry.')
  const data = await call('create_repair_shop_connection_invitation', {
    p_shop_id: shopId,
    p_expires_at: expiresAt ?? null,
  })
  if (!data?.id || typeof data.token !== 'string' || !data.expires_at)
    throw new Error('The shop invitation was not created.')
  requireConnectionToken(data.token)
  return data as ShopConnectionInvitation
}

// The fragment never reaches HTTP requests. Do not log or persist bearer links.
// The receiving route/UI will be implemented separately.
export function repairShopConnectionInvitationLink(
  token: string,
  applicationOrigin: string,
): string {
  requireConnectionToken(token)
  const origin = new URL(applicationOrigin)
  if (
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== '/' ||
    !(
      origin.protocol === 'https:' ||
      (origin.protocol === 'http:' &&
        ['localhost', '127.0.0.1'].includes(origin.hostname))
    )
  )
    throw new Error(
      'Use the application HTTPS origin or local development origin.',
    )
  const link = new URL('/shop-connections', origin.origin)
  link.hash = `shop-connection=${token}`
  return link.toString()
}

export async function previewRepairShopConnectionInvitation(
  token: string,
): Promise<ShopConnectionPreview> {
  requireConnectionToken(token)
  const data = await call('preview_repair_shop_connection_invitation', {
    p_token: token,
  })
  if (
    !data?.id ||
    !data.expires_at ||
    !data.shop?.id ||
    typeof data.shop.name !== 'string'
  )
    throw new Error('The shop invitation is unavailable.')
  return data as ShopConnectionPreview
}

export async function acceptRepairShopConnectionInvitation(
  token: string,
  vehicleId: string,
  canCreateRecords: boolean,
): Promise<string> {
  requireConnectionToken(token)
  if (typeof canCreateRecords !== 'boolean')
    throw new Error('Choose record creation permission.')
  return requireId(
    await call('accept_repair_shop_connection_invitation', {
      p_token: token,
      p_vehicle_id: vehicleId,
      p_can_create_records: canCreateRecords,
    }),
  )
}

export async function declineRepairShopConnectionInvitation(token: string) {
  requireConnectionToken(token)
  await call('decline_repair_shop_connection_invitation', { p_token: token })
}

export async function cancelRepairShopConnectionInvitation(
  shopId: string,
  invitationId: string,
) {
  await call('cancel_repair_shop_connection_invitation', {
    p_shop_id: shopId,
    p_invitation_id: invitationId,
  })
}

export async function listRepairShopConnectionInvitations(
  shopId: string,
): Promise<ShopConnectionInvitationStatus[]> {
  return requireList(
    await call('list_repair_shop_connection_invitations', {
      p_shop_id: shopId,
    }),
  )
}

export async function searchAvailableRepairShops(
  vehicleId: string,
  search = '',
  offset = 0,
  limit = 20,
): Promise<RepairShopDirectoryPage> {
  if (
    search.length > 128 ||
    !Number.isInteger(offset) ||
    offset < 0 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100
  )
    throw new Error('Choose a valid directory search and page.')
  const data = await call('search_available_repair_shops', {
    p_vehicle_id: vehicleId,
    p_search: search.trim(),
    p_offset: offset,
    p_limit: limit,
  })
  if (
    !data ||
    !Array.isArray(data.items) ||
    !Number.isInteger(data.total) ||
    data.total < 0 ||
    !Number.isInteger(data.offset) ||
    data.offset < 0 ||
    !Number.isInteger(data.limit) ||
    data.limit < 1
  )
    throw new Error('The shop directory is unavailable.')
  return data
}

export async function reviewOwnerShopRequest(
  vehicleId: string,
  authorizationId: string,
  outcome: 'accepted' | 'declined',
) {
  if (!['accepted', 'declined'].includes(outcome))
    throw new Error('Choose acceptance or decline.')
  await call('review_owner_shop_request', {
    p_vehicle_id: vehicleId,
    p_authorization_id: authorizationId,
    p_outcome: outcome,
  })
  notifyMaintenanceChange()
}

export async function setVehicleShopDataSharing(
  vehicleId: string,
  authorizationId: string,
  sharing: VehicleShopDataSharing,
) {
  if (
    typeof sharing.share_operation_names !== 'boolean' ||
    sharing.shared_visit_ids.length > 1000 ||
    sharing.shared_visit_ids.some((id) => !id) ||
    (sharing.customer_reference !== null &&
      (!sharing.customer_reference.trim() ||
        sharing.customer_reference.trim().length > 80))
  )
    throw new Error(
      'Review the customer reference and explicit sharing choices.',
    )
  await call('set_vehicle_shop_data_sharing', {
    p_vehicle_id: vehicleId,
    p_authorization_id: authorizationId,
    p_customer_reference: sharing.customer_reference?.trim() ?? null,
    p_share_operation_names: sharing.share_operation_names,
    p_shared_visit_ids: sharing.shared_visit_ids,
  })
  notifyMaintenanceChange()
}
