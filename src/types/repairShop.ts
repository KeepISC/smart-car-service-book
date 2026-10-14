import type { Vehicle } from './vehicle'
import type { MaintenanceInput } from './maintenance'
import type { ServiceOperationInput } from './serviceHistory'

export type ShopStaffRole = 'admin' | 'mechanic'
export type RepairShop = { id: string; name: string; role: ShopStaffRole }
export type RepairShopStaff = {
  user_id: string
  role: ShopStaffRole | null
  active: boolean
}
export type VehicleShopAuthorization = {
  id: string
  shop_id: string
  shop_name: string
  vehicle_id: string
  ownership_epoch: number
  initiated_by: 'owner' | 'shop'
  status:
    'pending' | 'approved' | 'revoked' | 'declined' | 'cancelled' | 'expired'
  expires_at: string | null
  can_create_records: boolean
  shop_accepted_at?: string | null
  share_operation_names?: boolean
  customer_reference?: string | null
  shared_visit_ids?: string[]
}
// Customer projections deliberately cannot satisfy the owner-facing Vehicle type.
export type ShopVehicle = {
  customer_reference?: string
  vehicle: Pick<
    Vehicle,
    'id' | 'type' | 'make' | 'model' | 'year' | 'engine' | 'mileage'
  >
  maintenance_schedules: (Omit<MaintenanceInput, 'name'> & {
    id: string
    name?: string
  })[]
  maintenance_records: {
    id: string
    service_date: string
    mileage: number
    notes?: string | null
    total_cost?: number | null
    service_type?: 'diy' | 'workshop'
    workshop_name?: string | null
    workshop_provenance?: {
      shop_id: string
      shop_name: string
      recorded_at: string
    } | null
    operations: (Pick<
      ServiceOperationInput,
      'maintenance_item_id' | 'next_interval_km' | 'next_interval_months'
    > &
      Partial<Pick<ServiceOperationInput, 'operation_name' | 'cost'>>)[]
  }[]
}

export type AvailableRepairShop = {
  id: string
  name: string
  contact_address: string | null
  contact_phone: string | null
  contact_website: string | null
}
export type RepairShopDirectoryPage = {
  items: AvailableRepairShop[]
  total: number
  offset: number
  limit: number
}
export type VehicleShopDataSharing = {
  customer_reference: string | null
  share_operation_names: boolean
  shared_visit_ids: string[]
}
export type ShopServiceVisitInput = {
  service_date: string
  mileage: number
  notes: string | null
  total_cost: number | null
  operations: Pick<
    ServiceOperationInput,
    'maintenance_item_id' | 'operation_name' | 'cost'
  >[]
}

export type ShopConnectionInvitation = {
  id: string
  token: string
  expires_at: string
}
export type ShopConnectionPreview = {
  id: string
  expires_at: string
  shop: { id: string; name: string }
}
export type ShopConnectionInvitationStatus = {
  id: string
  expires_at: string
  status: 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired'
}
