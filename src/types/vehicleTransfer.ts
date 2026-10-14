import type { Vehicle } from './vehicle'
import type { MaintenanceInput } from './maintenance'

export type VehicleTransferStatus =
  'pending' | 'accepted' | 'declined' | 'revoked' | 'expired'

export type VehicleTransferInvitation = {
  id: string
  token: string
  expires_at: string
}

export type VehicleTransferPreview = {
  id: string
  expires_at: string
  maintenance_schedules: (Pick<
    MaintenanceInput,
    | 'interval_km'
    | 'interval_months'
    | 'enabled'
    | 'history_status'
    | 'last_completed_date'
    | 'last_completed_mileage'
  > & { id: string })[]
  maintenance_records: {
    id: string
    service_date: string
    mileage: number
    private_on_transfer: boolean
    operations: {
      maintenance_item_id: string | null
      next_interval_km: number | null
      next_interval_months: number | null
    }[]
  }[]
  vehicle: Pick<
    Vehicle,
    'id' | 'type' | 'make' | 'model' | 'year' | 'engine' | 'mileage'
  >
}
