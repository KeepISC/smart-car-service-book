import { client } from './supabase'
import type {
  Vehicle,
  VehicleInput,
  VehicleMileageHistory,
} from '../types/vehicle'
import { validateVehicle } from './validation'
import { authService } from './auth'
import {
  isMileageConsistencyViolation,
  MileageConsistencyError,
} from './dataErrors'
import { notifyMaintenanceChange } from './maintenanceChanges'
let inFlightVehicles: { ownerId: string; promise: Promise<Vehicle[]> } | null =
  null

export async function listVehicles(): Promise<Vehicle[]> {
  const user = await authService.getUser()
  if (!user) throw new Error('Sign in to view your vehicles.')
  if (inFlightVehicles?.ownerId === user.id) return inFlightVehicles.promise
  const promise = Promise.resolve()
    .then(async () => {
      const { data, error } = await client()
        .from('vehicles')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as Vehicle[]
    })
    .finally(() => {
      if (inFlightVehicles?.promise === promise) inFlightVehicles = null
    })
  inFlightVehicles = { ownerId: user.id, promise }
  return promise
}
export async function getVehicle(id: string): Promise<Vehicle> {
  const { data, error } = await client()
    .from('vehicles')
    .select('*')
    .eq('id', id)
    .single()
  if (error) throw error
  return data
}
export async function saveVehicle(input: VehicleInput, id?: string) {
  // Explicitly select editable fields: fetched records also contain protected columns.
  const payload: VehicleInput = {
    type: input.type,
    make: input.make.trim(),
    model: input.model.trim(),
    year: input.year,
    engine: input.engine.trim(),
    mileage: input.mileage,
    license_plate: input.license_plate?.trim().toUpperCase() || null,
    vin: input.vin?.trim().toUpperCase() || null,
  }
  if (Object.keys(validateVehicle(payload)).length)
    throw new Error('Check the vehicle details before saving.')
  const db = client()
  const user = await authService.getUser()
  if (!user) throw new Error('Sign in to save your vehicle.')
  const query = id
    ? db.from('vehicles').update(payload).eq('id', id)
    : db.from('vehicles').insert({ ...payload, owner_id: user.id })
  const { data, error } = await query.select().single()
  if (error && isMileageConsistencyViolation(error))
    throw new MileageConsistencyError()
  if (error) throw error
  notifyVehicleChange(data.id)
  return data as Vehicle
}
export async function deleteVehicle(id: string) {
  const { data, error } = await client()
    .from('vehicles')
    .delete()
    .eq('id', id)
    .select('id')
  if (error) throw error
  if (!data?.length)
    throw new Error('This vehicle is unavailable or you do not have access.')
}

export async function updateVehicleMileage(
  vehicleOrId: Vehicle | string,
  mileage: number,
): Promise<Vehicle> {
  if (
    typeof mileage !== 'number' ||
    !Number.isInteger(mileage) ||
    mileage < 0 ||
    mileage > 10000000
  ) {
    throw new Error('Enter a whole number between 0 and 10,000,000.')
  }

  if (typeof vehicleOrId !== 'string' && mileage < vehicleOrId.mileage) {
    throw new Error(
      `Mileage cannot be decreased below the existing recorded ${vehicleOrId.mileage.toLocaleString()} km.`,
    )
  }

  const vehicleId =
    typeof vehicleOrId === 'string' ? vehicleOrId : vehicleOrId.id
  const { data, error } = await client()
    .rpc('update_vehicle_mileage', {
      p_vehicle_id: vehicleId,
      p_mileage: mileage,
    })
    .single()
  if (error && isMileageConsistencyViolation(error))
    throw new MileageConsistencyError()
  if (error) throw error
  if (!data) throw new Error('The mileage was not saved. Please try again.')

  notifyVehicleChange(vehicleId)

  return data as Vehicle
}

const inFlightMileageHistory = new Map<
  string,
  { ownerId: string; promise: Promise<VehicleMileageHistory[]> }
>()

function notifyVehicleChange(vehicleId: string) {
  // Refreshes must not join reads started before the committed vehicle change.
  inFlightVehicles = null
  inFlightMileageHistory.delete(vehicleId)
  notifyMaintenanceChange()
  if (typeof window !== 'undefined')
    window.dispatchEvent(new Event('app:vehicle-change'))
}

export async function loadVehicleMileageHistory(
  vehicleId: string,
): Promise<VehicleMileageHistory[]> {
  const user = await authService.getUser()
  if (!user) throw new Error('Sign in to view mileage history.')
  const inFlight = inFlightMileageHistory.get(vehicleId)
  if (inFlight?.ownerId === user.id) return inFlight.promise

  const promise = Promise.resolve()
    .then(async () => {
      const db = client()
      const rows: VehicleMileageHistory[] = []
      const pageSize = 500
      let cursor: VehicleMileageHistory | undefined
      for (;;) {
        let query = db
          .from('vehicle_mileage_history')
          .select('id, vehicle_id, recorded_at, mileage, source')
          .eq('vehicle_id', vehicleId)
          .order('recorded_at', { ascending: false })
          .order('id', { ascending: false })
        // Immutable history keys keep concurrent appends from shifting pages.
        if (cursor) {
          query = query.or(
            `recorded_at.lt.${cursor.recorded_at},and(recorded_at.eq.${cursor.recorded_at},id.lt.${cursor.id})`,
          )
        }
        const { data, error } = await query.range(0, pageSize - 1)
        if (error) throw error
        rows.push(...((data ?? []) as VehicleMileageHistory[]))
        if (!data || data.length < pageSize) return rows
        cursor = rows[rows.length - 1]
      }
    })
    .finally(() => {
      if (inFlightMileageHistory.get(vehicleId)?.promise === promise)
        inFlightMileageHistory.delete(vehicleId)
    })

  inFlightMileageHistory.set(vehicleId, { ownerId: user.id, promise })
  return promise
}
