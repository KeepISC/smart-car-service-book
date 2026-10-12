import { beforeEach, expect, it, vi } from 'vitest'
import type { Vehicle } from '../types/vehicle'
import { starterSchedule } from './maintenanceLogic'
const mock = vi.hoisted(() => {
  const query = { eq: vi.fn(), select: vi.fn() }
  query.eq.mockReturnValue(query)
  return {
    query,
    update: vi.fn().mockReturnValue(query),
    insert: vi.fn().mockReturnValue(query),
    delete: vi.fn().mockReturnValue(query),
  }
})
vi.mock('./supabase', () => ({
  client: () => ({
    from: () => ({
      update: mock.update,
      insert: mock.insert,
      delete: mock.delete,
    }),
  }),
}))
import { saveMaintenance, removeMaintenance } from './maintenance'
const vehicle = { id: 'fictional-vehicle', mileage: 10000 } as Vehicle
beforeEach(() => {
  vi.clearAllMocks()
  mock.query.select.mockResolvedValue({
    data: [{ id: 'fictional-item' }],
    error: null,
  })
})
it('scopes edits to both the vehicle and maintenance item', async () => {
  await saveMaintenance(vehicle, [starterSchedule[0]], 'fictional-item')
  expect(mock.query.eq).toHaveBeenCalledWith('id', 'fictional-item')
  expect(mock.query.eq).toHaveBeenCalledWith('vehicle_id', 'fictional-vehicle')
})
it('strips protected IDs from edits', async () => {
  await saveMaintenance(
    vehicle,
    [
      {
        ...starterSchedule[0],
        id: 'other-item',
        vehicle_id: 'other-vehicle',
      } as (typeof starterSchedule)[number],
    ],
    'fictional-item',
  )
  expect(mock.update).toHaveBeenCalledWith(starterSchedule[0])
})
it('propagates an RLS-denied unauthorized insert', async () => {
  mock.query.select.mockResolvedValue({
    data: null,
    error: new Error('row-level security policy'),
  })
  await expect(saveMaintenance(vehicle, [starterSchedule[0]])).rejects.toThrow(
    'row-level security',
  )
})
it('rejects edits and deletes hidden by owner isolation', async () => {
  mock.query.select.mockResolvedValue({ data: [], error: null })
  await expect(
    saveMaintenance(vehicle, [starterSchedule[0]], 'other-owner-item'),
  ).rejects.toThrow('authorized')
  await expect(
    removeMaintenance(vehicle.id, 'other-owner-item'),
  ).rejects.toThrow('unavailable')
})
it('rejects invalid intervals before writing', async () => {
  await expect(
    saveMaintenance(vehicle, [{ ...starterSchedule[0], interval_km: -1 }]),
  ).rejects.toThrow('Review')
  expect(mock.insert).not.toHaveBeenCalled()
})
