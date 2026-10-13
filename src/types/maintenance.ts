export type HistoryStatus = 'known' | 'unknown' | 'not_applicable'
export type MaintenanceInput = {
  name: string
  interval_km: number | null
  interval_months: number | null
  enabled: boolean
  history_status: HistoryStatus
  last_completed_date: string | null
  last_completed_mileage: number | null
}
export type MaintenanceItem = MaintenanceInput & {
  id: string
  vehicle_id: string
  created_at: string
  updated_at: string
  next_interval_km?: number | null
  next_interval_months?: number | null
}
export type MaintenanceTemplate = {
  id: string
  name: string
  vehicle_type: 'car' | 'motorcycle'
  make: string
  model: string
  year_from: number
  year_to: number
  engine: string
  source_name: string
  source_url: string
  source_notes: string | null
  verified: boolean
  verified_at: string | null
  maintenance_template_items: MaintenanceInput[]
}
export type MaintenanceAlertItem = {
  id: string
  vehicleId: string
  vehicleName: string
  operationName: string
  status: 'Due / overdue' | 'Due soon'
  dueDate: string | null
  dueMileage: number | null
  kmRemaining: number | null
  daysRemaining: number | null
}
export type MaintenanceAlertSummary = {
  overdue: number
  dueSoon: number
  alerts?: MaintenanceAlertItem[]
}
