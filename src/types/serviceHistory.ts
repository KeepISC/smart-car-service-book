export type ServiceType = 'diy' | 'workshop'

export type ServiceOperationInput = {
  maintenance_item_id: string | null
  operation_name: string
  cost: number | null
  next_interval_km: number | null
  next_interval_months: number | null
}

export type ServiceVisitInput = {
  service_date: string
  mileage: number
  service_type: ServiceType
  workshop_name: string | null
  total_cost: number | null
  notes: string | null
  operations: ServiceOperationInput[]
}

export type ServiceOperation = ServiceOperationInput & {
  id: string
  service_visit_id: string
  created_at: string
  updated_at: string
}

export type ServiceVisit = Omit<ServiceVisitInput, 'operations'> & {
  id: string
  vehicle_id: string
  created_at: string
  updated_at: string
  operations: ServiceOperation[]
}
