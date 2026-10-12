import { describe, expect, it } from 'vitest'
import { validateVehicle } from './validation'
import type { VehicleInput } from '../types/vehicle'
const valid: VehicleInput = {
  type: 'car',
  make: 'Fictional Motors',
  model: 'Example',
  year: 2020,
  engine: '1.0 Example',
  mileage: 0,
  license_plate: null,
  vin: null,
}
describe('vehicle validation', () => {
  it('accepts valid vehicle essentials and optional empty values', () =>
    expect(validateVehicle(valid)).toEqual({}))
  it('rejects blank essentials, invalid years and negative mileage', () =>
    expect(
      validateVehicle({ ...valid, make: ' ', year: 1800, mileage: -1 }),
    ).toHaveProperty('make'))
  it.each([-1, 1.5, 10000001, NaN])('rejects invalid mileage %s', (mileage) =>
    expect(validateVehicle({ ...valid, mileage })).toHaveProperty('mileage'),
  )
  it.each([1885, new Date().getFullYear() + 2, 2020.5])(
    'rejects invalid year %s',
    (year) =>
      expect(validateVehicle({ ...valid, year })).toHaveProperty('year'),
  )
  it('rejects VIN with forbidden letters and long plates', () => {
    const errors = validateVehicle({
      ...valid,
      vin: 'IIIIIIIIIIIIIIIII',
      license_plate: 'X'.repeat(21),
    })
    expect(errors).toHaveProperty('vin')
    expect(errors).toHaveProperty('license_plate')
  })
  it('accepts a fictional syntactically valid VIN', () =>
    expect(validateVehicle({ ...valid, vin: 'TEST0000000000001' })).toEqual({}))
})
