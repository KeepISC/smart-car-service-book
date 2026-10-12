import { beforeEach, expect, it, vi } from 'vitest'
import type { VehicleInput } from '../types/vehicle'
const mocks = vi.hoisted(() => {
  const single = vi.fn()
  const query = { eq: vi.fn(), select: vi.fn(), single }
  query.eq.mockReturnValue(query)
  query.select.mockReturnValue(query)
  return {
    query,
    update: vi.fn().mockReturnValue(query),
    insert: vi.fn().mockReturnValue(query),
    delete: vi.fn().mockReturnValue(query),
    getUser: vi.fn(),
  }
})
vi.mock('./supabase', () => ({
  configured: true,
  client: () => ({
    auth: { getUser: mocks.getUser },
    from: () => ({
      update: mocks.update,
      insert: mocks.insert,
      delete: mocks.delete,
    }),
  }),
}))
import { saveVehicle, deleteVehicle } from './vehicles'
vi.mock('./auth', () => ({
  authService: {
    getUser: async () => {
      const { data, error } = await mocks.getUser()
      if (error) throw error
      return data.user
    },
  },
}))
const input: VehicleInput = {
  type: 'car',
  make: ' Fictional Motors ',
  model: 'Example',
  year: 2020,
  engine: '1.0',
  mileage: 0,
  license_plate: null,
  vin: null,
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.query.select.mockReturnValue(mocks.query)
  mocks.getUser.mockResolvedValue({
    data: { user: { id: 'test-owner' } },
    error: null,
  })
  mocks.query.single.mockResolvedValue({
    data: { id: 'test-vehicle' },
    error: null,
  })
})
it('creates a record with the authenticated owner', async () => {
  await saveVehicle(input)
  expect(mocks.insert).toHaveBeenCalledWith({
    ...input,
    make: 'Fictional Motors',
    owner_id: 'test-owner',
  })
})
it('never sends protected fields when editing a fetched record', async () => {
  await saveVehicle(
    {
      ...input,
      owner_id: 'other-owner',
      created_at: 'fictional',
      id: 'test-vehicle',
    } as VehicleInput,
    'test-vehicle',
  )
  expect(mocks.update).toHaveBeenCalledWith({
    ...input,
    make: 'Fictional Motors',
  })
  expect(mocks.query.eq).toHaveBeenCalledWith('id', 'test-vehicle')
})
it('rejects unauthenticated writes', async () => {
  mocks.getUser.mockResolvedValue({ data: { user: null }, error: null })
  await expect(saveVehicle(input)).rejects.toThrow('Sign in')
  expect(mocks.insert).not.toHaveBeenCalled()
})
it('rejects invalid input before contacting the database', async () => {
  await expect(saveVehicle({ ...input, mileage: -1 })).rejects.toThrow('Check')
  expect(mocks.getUser).not.toHaveBeenCalled()
})
it('propagates a failed database operation', async () => {
  mocks.query.single.mockResolvedValue({
    data: null,
    error: new Error('Database unavailable'),
  })
  await expect(saveVehicle(input)).rejects.toThrow('Database unavailable')
})
it('maps the database odometer guard to a clear validation error', async () => {
  mocks.query.single.mockResolvedValue({
    data: null,
    error: {
      code: '23514',
      message: 'Vehicle mileage is below a recorded maintenance completion',
    },
  })
  await expect(
    saveVehicle({ ...input, mileage: 10000 }, 'test-vehicle'),
  ).rejects.toThrow('highest recorded maintenance')
})
it('deletes only when the database returns an accessible deleted row', async () => {
  mocks.query.select.mockResolvedValue({
    data: [{ id: 'test-vehicle' }],
    error: null,
  })
  await expect(deleteVehicle('test-vehicle')).resolves.toBeUndefined()
  expect(mocks.query.eq).toHaveBeenCalledWith('id', 'test-vehicle')
  expect(mocks.query.select).toHaveBeenCalledWith('id')
})
it.each([[], null])(
  'does not report successful deletion for missing or RLS-hidden rows',
  async (data) => {
    mocks.query.select.mockResolvedValue({ data, error: null })
    await expect(deleteVehicle('unavailable-vehicle')).rejects.toThrow(
      'unavailable or you do not have access',
    )
  },
)
it('propagates deletion failures', async () => {
  mocks.query.select.mockResolvedValue({
    data: null,
    error: new Error('Fictional network failure'),
  })
  await expect(deleteVehicle('test-vehicle')).rejects.toThrow(
    'Fictional network failure',
  )
})
