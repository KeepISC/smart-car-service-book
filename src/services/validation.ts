import type { VehicleInput } from '../types/vehicle'
export function validateVehicle(v: VehicleInput): Record<string, string> {
  const errors: Record<string, string> = {}
  if (!['car', 'motorcycle'].includes(v.type))
    errors.type = 'Choose a car or motorcycle.'
  for (const field of ['make', 'model', 'engine'] as const)
    if (!v[field].trim() || v[field].trim().length > 100)
      errors[field] = 'Enter between 1 and 100 characters.'
  if (
    !Number.isInteger(v.year) ||
    v.year < 1886 ||
    v.year > new Date().getFullYear() + 1
  )
    errors.year = 'Enter a valid vehicle year.'
  if (!Number.isInteger(v.mileage) || v.mileage < 0 || v.mileage > 10000000)
    errors.mileage = 'Enter a whole number between 0 and 10,000,000.'
  if (v.license_plate && v.license_plate.length > 20)
    errors.license_plate = 'Use 20 characters or fewer.'
  if (v.vin && !/^[A-HJ-NPR-Z0-9]{17}$/.test(v.vin))
    errors.vin = 'Use a 17-character VIN without I, O or Q.'
  return errors
}
