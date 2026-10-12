import { client } from './supabase'
import { validateMaintenance } from './maintenanceLogic'
import {
  isMileageConsistencyViolation,
  MileageConsistencyError,
} from './dataErrors'
import type {
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
export async function loadMaintenance(vehicle: Vehicle) {
  const db = client()
  const items = await db
    .from('vehicle_maintenance_items')
    .select('*')
    .eq('vehicle_id', vehicle.id)
    .order('created_at')
  if (items.error) throw items.error
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
    items: (items.data ?? []) as MaintenanceItem[],
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
        .update(payloads[0])
        .eq('id', id)
        .eq('vehicle_id', vehicle.id)
    : db
        .from('vehicle_maintenance_items')
        .insert(payloads.map((item) => ({ ...item, vehicle_id: vehicle.id })))
  const { data, error } = await query.select()
  if (error && isMileageConsistencyViolation(error))
    throw new MileageConsistencyError()
  if (error) throw error
  if (!data?.length)
    throw new Error('No authorized maintenance items were saved.')
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
}
