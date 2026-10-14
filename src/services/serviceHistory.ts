import { client } from './supabase'
import { notifyMaintenanceChange } from './maintenanceChanges'
import { validateServiceVisit } from './serviceHistoryLogic'
import { dateOnly } from './maintenanceLogic'
import type { ServiceVisit, ServiceVisitInput } from '../types/serviceHistory'
import type { Vehicle } from '../types/vehicle'
import { isServiceHistoryEnabled } from '../config/features'

function requireServiceHistory() {
  if (!isServiceHistoryEnabled())
    throw new Error('Service history is not enabled.')
}

type ServiceOperationRow = ServiceVisit['operations'][number]
type ServiceVisitRow = Omit<ServiceVisit, 'operations'>
type ServiceVisitWithOperations = ServiceVisitRow & {
  service_operations: ServiceOperationRow[] | null
}

export async function loadServiceHistory(
  vehicleId: string,
): Promise<ServiceVisit[]> {
  requireServiceHistory()
  const db = client()
  const rows: ServiceVisitWithOperations[] = []
  const pageSize = 500
  // Read every page so API row limits cannot silently hide a completion.
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await db
      .from('service_visits')
      .select('*, service_operations(*)')
      .eq('vehicle_id', vehicleId)
      .order('service_date', { ascending: false })
      .order('mileage', { ascending: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + pageSize - 1)
    if (error) throw error
    rows.push(...((data ?? []) as ServiceVisitWithOperations[]))
    if (!data || data.length < pageSize) break
  }
  return rows.map(({ service_operations, ...visit }) => ({
    ...visit,
    operations: service_operations ?? [],
  }))
}

export async function saveServiceVisit(
  vehicle: Vehicle,
  input: ServiceVisitInput,
  visitId?: string,
): Promise<string> {
  requireServiceHistory()
  if (validateServiceVisit(input, vehicle.mileage, dateOnly()).length)
    throw new Error('Review service visit details before saving.')
  const { data, error } = await client().rpc('save_service_visit', {
    p_vehicle_id: vehicle.id,
    p_visit_id: visitId ?? null,
    p_payload: input,
  })
  if (error) throw error
  if (typeof data !== 'string' || !data)
    throw new Error('The service visit was not saved. Please try again.')
  notifyMaintenanceChange()
  return data
}

export async function deleteServiceVisit(vehicleId: string, visitId: string) {
  requireServiceHistory()
  const { error } = await client().rpc('delete_service_visit', {
    p_vehicle_id: vehicleId,
    p_visit_id: visitId,
  })
  if (error) throw error
  notifyMaintenanceChange()
}

export async function setServiceVisitTransferPrivacy(
  vehicleId: string,
  visitId: string,
  privateOnTransfer: boolean,
) {
  requireServiceHistory()
  if (typeof privateOnTransfer !== 'boolean')
    throw new Error('Choose whether this visit is private on transfer.')
  const { error } = await client().rpc('set_service_visit_transfer_privacy', {
    p_vehicle_id: vehicleId,
    p_visit_id: visitId,
    p_private: privateOnTransfer,
  })
  if (error) throw error
  notifyMaintenanceChange()
}
