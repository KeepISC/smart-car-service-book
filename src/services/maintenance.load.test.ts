import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Vehicle } from '../types/vehicle'

const api = vi.hoisted(() => ({ from: vi.fn(), loadServiceHistory: vi.fn() }))
vi.mock('./supabase', () => ({ client: () => ({ from: api.from }) }))
vi.mock('./serviceHistory', () => ({
  loadServiceHistory: api.loadServiceHistory,
}))
import { loadGarageMaintenanceSummary, loadMaintenance } from './maintenance'

const vehicle = {
  id: 'fictional',
  type: 'car',
  make: 'Fictional',
  model: 'Example',
  engine: 'Example',
  year: 2020,
  mileage: 50000,
} as Vehicle
const baseline = {
  id: 'schedule',
  name: 'Fictional inspection',
  vehicle_id: vehicle.id,
  history_status: 'known',
  last_completed_date: '2026-09-01',
  last_completed_mileage: 10000,
  interval_km: 10000,
  interval_months: 12,
}
function query(data: unknown[]) {
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    ilike: vi.fn(),
    lte: vi.fn(),
    gte: vi.fn(),
    then: vi.fn(),
  }
  for (const key of ['select', 'eq', 'order', 'ilike', 'lte', 'gte'] as const)
    builder[key].mockReturnValue(builder)
  builder.then.mockImplementation((resolve) => resolve({ data, error: null }))
  return builder
}
beforeEach(() => {
  vi.clearAllMocks()
  api.from.mockImplementation((table) =>
    query(table === 'vehicle_maintenance_items' ? [baseline] : []),
  )
})
afterEach(() => vi.unstubAllEnvs())

it('loads legacy maintenance without touching Service History when disabled', async () => {
  vi.stubEnv('VITE_SERVICE_HISTORY_ENABLED', 'false')
  api.loadServiceHistory.mockRejectedValue(new Error('History schema absent'))
  expect((await loadMaintenance(vehicle)).items).toEqual([baseline])
  expect(api.from.mock.calls.map(([table]) => table)).toEqual([
    'vehicle_maintenance_items',
    'maintenance_templates',
  ])
  expect(api.loadServiceHistory).not.toHaveBeenCalled()
})
it('uses linked completions and overrides only after explicit activation', async () => {
  vi.stubEnv('VITE_SERVICE_HISTORY_ENABLED', 'true')
  api.loadServiceHistory.mockResolvedValue([
    {
      id: 'visit',
      service_date: '2026-10-01',
      mileage: 30000,
      created_at: '2026-10-01',
      operations: [
        {
          id: 'operation',
          maintenance_item_id: baseline.id,
          next_interval_km: 6000,
          next_interval_months: null,
          created_at: '2026-10-01',
        },
      ],
    },
  ])
  expect((await loadMaintenance(vehicle)).items[0]).toMatchObject({
    last_completed_date: '2026-10-01',
    last_completed_mileage: 30000,
    next_interval_km: 6000,
  })
})

it('loads garage maintenance summary without queries when vehicle list is empty', async () => {
  const summary = await loadGarageMaintenanceSummary([])
  expect(summary).toEqual({ overdue: 0, dueSoon: 0 })
  expect(api.from).not.toHaveBeenCalled()
})

it('aggregates garage maintenance summary across vehicles using loaded items', async () => {
  vi.stubEnv('VITE_SERVICE_HISTORY_ENABLED', 'false')
  api.from.mockImplementation((table) =>
    query(
      table === 'vehicle_maintenance_items'
        ? [{ ...baseline, enabled: true }]
        : [],
    ),
  )
  // baseline with enabled: true has next mileage: 10000 + 10000 = 20000.
  // vehicle has mileage: 50000. 50000 >= 20000 -> overdue!
  const summary = await loadGarageMaintenanceSummary([vehicle])
  expect(summary).toEqual({ overdue: 1, dueSoon: 0 })
  expect(api.from).toHaveBeenCalledWith('vehicle_maintenance_items')
})
