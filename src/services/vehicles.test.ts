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
    getUser: vi.fn(),
  }
})
vi.mock('./supabase', () => ({
  configured: true,
  client: () => ({
    auth: { getUser: mocks.getUser },
    from: () => ({ update: mocks.update, insert: mocks.insert }),
  }),
}))
import { saveVehicle } from './vehicles'
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
