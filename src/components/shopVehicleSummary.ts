import {
  aggregateMaintenanceAlerts,
  applyServiceHistory,
  calculateMaintenance,
  dateOnly,
  type MaintenanceStatus,
} from '../services/maintenanceLogic'
import type { MaintenanceItem } from '../types/maintenance'
import type { ShopVehicle } from '../types/repairShop'

export type ShopScheduleStatus = {
  id: string
  label: string
  status: MaintenanceStatus
  nextMileage: number | null
  nextDate: string | null
}
export type ShopVehicleSummary = {
  overdue: number
  dueSoon: number
  overall: 'Due / overdue' | 'Due soon' | 'Up to date' | 'Unknown'
  lastServiceDate: string | null
  schedules: ShopScheduleStatus[]
}

// The sanitized projection omits schedule names, creation timestamps and
// operation IDs. Placeholders only break ties; the server already orders
// visits newest-first, so earlier positions receive larger sort keys. All
// due-date and mileage rules come from the existing maintenance logic.
export function summarizeShopVehicle(
  data: ShopVehicle,
  today = dateOnly(),
): ShopVehicleSummary {
  const items = data.maintenance_schedules.map(
    (schedule, index) =>
      ({
        ...schedule,
        name: schedule.name || `Schedule ${index + 1}`,
        vehicle_id: data.vehicle.id,
        created_at: '',
        updated_at: '',
      }) as MaintenanceItem,
  )
  const total = data.maintenance_records.length
  const visits = data.maintenance_records.map((record, index) => {
    const created = String(total - index).padStart(8, '0')
    return {
      id: record.id,
      service_date: record.service_date,
      mileage: record.mileage,
      created_at: created,
      operations: record.operations.map((operation, position) => ({
        ...operation,
        id: `${created}-${String(999 - position).padStart(3, '0')}`,
        created_at: created,
      })),
    }
  })
  const current = applyServiceHistory(items, visits)
  const schedules = current.map((item, index) => ({
    id: item.id,
    label: item.name || `Schedule ${index + 1}`,
    ...calculateMaintenance(item, data.vehicle.mileage, today),
  }))
  const { overdue, dueSoon } = aggregateMaintenanceAlerts(
    [{ vehicle: data.vehicle, items: current }],
    today,
  )
  const known = schedules.some(
    (schedule) =>
      schedule.status === 'Up to date' ||
      schedule.status === 'Due soon' ||
      schedule.status === 'Due / overdue',
  )
  return {
    overdue,
    dueSoon,
    overall: overdue
      ? 'Due / overdue'
      : dueSoon
        ? 'Due soon'
        : known
          ? 'Up to date'
          : 'Unknown',
    lastServiceDate:
      data.maintenance_records
        .map((record) => record.service_date)
        .sort()
        .at(-1) ?? null,
    schedules,
  }
}

// Shops receive only an opaque authorization ID; a short form serves as the
// connection reference because no customer identity is available to them.
export const connectionRef = (id: string) => id.slice(0, 8).toUpperCase()
