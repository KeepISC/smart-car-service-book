import { client } from './supabase'
import type { Vehicle, VehicleInput } from '../types/vehicle'
import { validateVehicle } from './validation'
import { authService } from './auth'
import {
  isMileageConsistencyViolation,
  MileageConsistencyError,
} from './dataErrors'
export async function listVehicles(): Promise<Vehicle[]> {
  const { data, error } = await client()
    .from('vehicles')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
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
