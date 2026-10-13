import { client } from './supabase'
import {
  maintenanceRevision,
  notifyMaintenanceChange,
} from './maintenanceChanges'
import { loadServiceHistory } from './serviceHistory'
import { isServiceHistoryEnabled } from '../config/features'
import {
  aggregateMaintenanceAlerts,
  applyServiceHistory,
  dateOnly,
  getMaintenanceAlertDetails,
  validateMaintenance,
} from './maintenanceLogic'
import {
  isMileageConsistencyViolation,
  MileageConsistencyError,
  MaintenanceCompletionConflictError,
} from './dataErrors'
import type {
  MaintenanceAlertSummary,
  MaintenanceInput,
  MaintenanceItem,
  MaintenanceTemplate,
} from '../types/maintenance'
import type { Vehicle } from '../types/vehicle'
export function maintenancePayload(input: MaintenanceInput): MaintenanceInput {
  return {
    name: input.name.trim(),
    interval_km: input.interval_km,
    interval_months: input.interval_months,
    enabled: input.enabled,
    history_status: input.history_status,
    last_completed_date:
      input.history_status === 'known' ? input.last_completed_date : null,
    last_completed_mileage:
      input.history_status === 'known' ? input.last_completed_mileage : null,
  }
}
function maintenanceSchedulePayload(input: MaintenanceInput) {
  const payload = maintenancePayload(input)
  return {
    name: payload.name,
    interval_km: payload.interval_km,
    interval_months: payload.interval_months,
    enabled: payload.enabled,
  }
}
export async function loadVehicleMaintenance(
  vehicle: Vehicle,
): Promise<MaintenanceItem[]> {
  const db = client()
  const items = await db
    .from('vehicle_maintenance_items')
    .select('*')
    .eq('vehicle_id', vehicle.id)
    .order('created_at')
  if (items.error) throw items.error
  const history = isServiceHistoryEnabled()
    ? await loadServiceHistory(vehicle.id)
    : []
  return applyServiceHistory((items.data ?? []) as MaintenanceItem[], history)
}
let inFlightSummary: {
  key: string
  promise: Promise<MaintenanceAlertSummary>
} | null = null

export async function loadGarageMaintenanceSummary(
  vehicles: Vehicle[],
  today = dateOnly(),
): Promise<MaintenanceAlertSummary> {
  if (!vehicles.length) {
    return { overdue: 0, dueSoon: 0, alerts: [] }
  }
  const key = `${maintenanceRevision()}:${today}:${vehicles
    .map((v) => JSON.stringify(v))
    .sort()
    .join(';')}`
  if (inFlightSummary && inFlightSummary.key === key) {
    return inFlightSummary.promise
  }

  const promise = (async () => {
    try {
      const results = await Promise.all(
        vehicles.map(async (vehicle) => {
          const items = await loadVehicleMaintenance(vehicle)
          return { vehicle, items }
        }),
      )
      const summary = aggregateMaintenanceAlerts(results, today)
      const alerts = getMaintenanceAlertDetails(results, today)
      return { ...summary, alerts }
    } finally {
      if (inFlightSummary?.key === key) {
        inFlightSummary = null
      }
    }
  })()

  inFlightSummary = { key, promise }
  return promise
}
export async function loadMaintenance(vehicle: Vehicle) {
  const db = client()
  const items = await loadVehicleMaintenance(vehicle)
  const templates = await db
    .from('maintenance_templates')
    .select('*, maintenance_template_items(*)')
    .eq('verified', true)
    .eq('vehicle_type', vehicle.type)
    .ilike('make', vehicle.make.replace(/[\\%_]/g, '\\$&'))
    .ilike('model', vehicle.model.replace(/[\\%_]/g, '\\$&'))
    .ilike('engine', vehicle.engine.replace(/[\\%_]/g, '\\$&'))
    .lte('year_from', vehicle.year)
    .gte('year_to', vehicle.year)
  if (templates.error) throw templates.error
  return {
    items,
    templates: (templates.data ?? []) as MaintenanceTemplate[],
  }
}
export async function saveMaintenance(
  vehicle: Vehicle,
  inputs: MaintenanceInput[],
  id?: string,
) {
  const payloads = inputs.map(maintenancePayload)
  if (
    payloads.some((item) => validateMaintenance(item, vehicle.mileage).length)
  )
    throw new Error('Review maintenance details before saving.')
  if (id && payloads.length !== 1)
    throw new Error('Edit one maintenance operation at a time.')
  const db = client()
  const query = id
    ? db
        .from('vehicle_maintenance_items')
        .update(
          isServiceHistoryEnabled()
            ? maintenanceSchedulePayload(inputs[0])
            : payloads[0],
        )
        .eq('id', id)
        .eq('vehicle_id', vehicle.id)
    : db
        .from('vehicle_maintenance_items')
        .insert(payloads.map((item) => ({ ...item, vehicle_id: vehicle.id })))
  const { data, error } = await query.select()
  if (error && isMileageConsistencyViolation(error))
    throw new MileageConsistencyError()
  if (
    error?.code === '23514' &&
    error.message === 'Completion is managed by service history'
  )
    throw new MaintenanceCompletionConflictError()
  if (error) throw error
  if (!data?.length)
    throw new Error('No authorized maintenance items were saved.')
  notifyMaintenanceChange()
  return data as MaintenanceItem[]
}
export async function removeMaintenance(vehicleId: string, id: string) {
  const { data, error } = await client()
    .from('vehicle_maintenance_items')
    .delete()
    .eq('id', id)
    .eq('vehicle_id', vehicleId)
    .select('id')
  if (error) throw error
  if (!data?.length) throw new Error('The maintenance item is unavailable.')
  notifyMaintenanceChange()
}
