export type Vehicle = {
  id: string
  owner_id: string
  type: 'car' | 'motorcycle'
  make: string
  model: string
  year: number
  engine: string
  mileage: number
  license_plate: string | null
  vin: string | null
  created_at: string
  updated_at: string
}
export type VehicleInput = Pick<
  Vehicle,
  | 'type'
  | 'make'
  | 'model'
  | 'year'
  | 'engine'
  | 'mileage'
  | 'license_plate'
  | 'vin'
>
