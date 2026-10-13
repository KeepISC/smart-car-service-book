import { beforeEach, expect, it, vi } from 'vitest'
import { aggregateMaintenanceAlerts } from './maintenanceLogic'
import type {
  Vehicle,
  VehicleInput,
  VehicleMileageHistory,
} from '../types/vehicle'
const mocks = vi.hoisted(() => {
  const single = vi.fn()
  const rpcSingle = vi.fn()
  const query = {
    eq: vi.fn(),
    select: vi.fn(),
    order: vi.fn(),
    range: vi.fn(),
    or: vi.fn(),
    single,
  }
  query.eq.mockReturnValue(query)
  query.select.mockReturnValue(query)
  query.order.mockReturnValue(query)
  query.or.mockReturnValue(query)
  return {
    query,
    rpcSingle,
    rpc: vi.fn().mockReturnValue({ single: rpcSingle }),
    from: vi.fn(),
    fromSelect: vi.fn().mockReturnValue(query),
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
    rpc: mocks.rpc,
    from: (table: string) => {
      mocks.from(table)
      return {
        select: mocks.fromSelect,
        update: mocks.update,
        insert: mocks.insert,
        delete: mocks.delete,
      }
    },
  }),
}))
import {
  saveVehicle,
  deleteVehicle,
  updateVehicleMileage,
  loadVehicleMileageHistory,
  listVehicles,
} from './vehicles'
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
  mocks.query.order.mockReturnValue(mocks.query)
  mocks.getUser.mockResolvedValue({
    data: { user: { id: 'test-owner' } },
    error: null,
  })
  mocks.query.single.mockResolvedValue({
    data: { id: 'test-vehicle' },
    error: null,
  })
  mocks.rpcSingle.mockResolvedValue({
    data: { id: 'test-vehicle' },
    error: null,
  })
  mocks.query.range.mockResolvedValue({ data: [], error: null })
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

const testVehicle: Vehicle = {
  id: 'veh-1',
  owner_id: 'test-owner',
  created_at: '2020-01-01T00:00:00Z',
  updated_at: '2020-01-01T00:00:00Z',
  type: 'car',
  make: 'Fictional Motors',
  model: 'Example',
  year: 2020,
  engine: '1.0',
  mileage: 10000,
  license_plate: 'ABC-123',
  vin: null,
}

it('updates vehicle mileage and notifies maintenance changes when given a vehicle object', async () => {
  const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
  mocks.rpcSingle.mockResolvedValue({
    data: { ...testVehicle, mileage: 12500 },
    error: null,
  })

  const result = await updateVehicleMileage(testVehicle, 12500)
  expect(result.mileage).toBe(12500)
  expect(mocks.rpc).toHaveBeenCalledWith('update_vehicle_mileage', {
    p_vehicle_id: 'veh-1',
    p_mileage: 12500,
  })
  expect(mocks.update).not.toHaveBeenCalled()
  expect(mocks.insert).not.toHaveBeenCalled()
  expect(dispatchSpy).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'app:maintenance-change' }),
  )
  expect(dispatchSpy).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'app:vehicle-change' }),
  )
  dispatchSpy.mockRestore()
})

it('uses the atomic mileage RPC directly when given a vehicle id string', async () => {
  const existingVehicle: Vehicle = {
    ...testVehicle,
    id: 'veh-2',
    year: 2021,
    engine: '1.5',
    mileage: 20000,
  }
  mocks.rpcSingle.mockResolvedValue({
    data: { ...existingVehicle, mileage: 25000 },
    error: null,
  })

  const result = await updateVehicleMileage('veh-2', 25000)
  expect(mocks.fromSelect).not.toHaveBeenCalled()
  expect(mocks.rpc).toHaveBeenCalledWith('update_vehicle_mileage', {
    p_vehicle_id: 'veh-2',
    p_mileage: 25000,
  })
  expect(result.mileage).toBe(25000)
})

it('rejects mileage decreases below the current vehicle mileage', async () => {
  await expect(
    updateVehicleMileage({ ...testVehicle, mileage: 15000 }, 14999),
  ).rejects.toThrow(
    'Mileage cannot be decreased below the existing recorded 15,000 km.',
  )
  expect(mocks.update).not.toHaveBeenCalled()
  expect(mocks.rpc).not.toHaveBeenCalled()
})

it.each([-1, 12.5, 10000001, NaN])(
  'rejects invalid mileage %s in updateVehicleMileage',
  async (mileage) => {
    await expect(updateVehicleMileage(testVehicle, mileage)).rejects.toThrow(
      'Enter a whole number between 0 and 10,000,000.',
    )
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  },
)

it('propagates mileage consistency error when below recorded maintenance completion', async () => {
  mocks.rpcSingle.mockResolvedValue({
    data: null,
    error: {
      code: '23514',
      message: 'Vehicle mileage is below a recorded maintenance completion',
    },
  })
  await expect(updateVehicleMileage(testVehicle, 12000)).rejects.toThrow(
    'highest recorded maintenance',
  )
})

it.each([
  {
    code: '23514',
    message: 'Mileage cannot be decreased below the existing recorded mileage.',
  },
  { code: '40001', message: 'Fictional serialization failure' },
  { code: '42501', message: 'Vehicle is unavailable or access is denied' },
])(
  'propagates rejected mileage updates without notifications: $code',
  async (error) => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
    mocks.rpcSingle.mockResolvedValue({ data: null, error })
    await expect(updateVehicleMileage(testVehicle, 12000)).rejects.toEqual(
      error,
    )
    expect(dispatchSpy).not.toHaveBeenCalled()
    dispatchSpy.mockRestore()
  },
)

it('rejects an empty mileage RPC response without notifications', async () => {
  const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
  mocks.rpcSingle.mockResolvedValue({ data: null, error: null })
  await expect(updateVehicleMileage('veh-1', 12000)).rejects.toThrow(
    'not saved',
  )
  expect(dispatchSpy).not.toHaveBeenCalled()
  dispatchSpy.mockRestore()
})

it('reads all history pages with a timestamp and ID cursor instead of shifting offsets', async () => {
  const entry = {
    id: 'entry',
    vehicle_id: 'veh-1',
    recorded_at: '2026-01-01T00:00:00Z',
    mileage: 12000,
    source: 'manual',
  }
  const page = Array.from({ length: 500 }, (_, index) => ({
    ...entry,
    id: `entry-${String(500 - index).padStart(4, '0')}`,
  }))
  const older = { ...entry, id: 'entry-0000' }
  mocks.query.range
    .mockResolvedValueOnce({
      data: page,
      error: null,
    })
    .mockResolvedValueOnce({ data: [older], error: null })
  const history = await loadVehicleMileageHistory('veh-1')
  expect(history).toEqual([...page, older])
  expect(new Set(history.map((row) => row.id)).size).toBe(501)
  expect(mocks.from).toHaveBeenCalledWith('vehicle_mileage_history')
  expect(mocks.query.eq).toHaveBeenCalledWith('vehicle_id', 'veh-1')
  expect(mocks.query.order).toHaveBeenCalledWith('recorded_at', {
    ascending: false,
  })
  expect(mocks.query.order).toHaveBeenCalledWith('id', { ascending: false })
  expect(mocks.query.range.mock.calls).toEqual([
    [0, 499],
    [0, 499],
  ])
  expect(mocks.query.or).toHaveBeenCalledWith(
    'recorded_at.lt.2026-01-01T00:00:00Z,and(recorded_at.eq.2026-01-01T00:00:00Z,id.lt.entry-0001)',
  )
})

it.each([[], null])(
  'returns empty history for an empty or RLS-hidden result',
  async (data) => {
    mocks.query.range.mockResolvedValue({ data, error: null })
    await expect(loadVehicleMileageHistory('unavailable')).resolves.toEqual([])
  },
)

it('propagates history read failures without returning partial history', async () => {
  const error = new Error('Fictional history read failure')
  mocks.query.range
    .mockResolvedValueOnce({
      data: Array.from({ length: 500 }, (_, index) => ({
        id: `entry-${index}`,
        recorded_at: '2026-01-01T00:00:00Z',
        mileage: 12000,
      })),
      error: null,
    })
    .mockResolvedValueOnce({ data: null, error })
  await expect(loadVehicleMileageHistory('veh-1')).rejects.toBe(error)
})

it('deduplicates concurrent mileage history reads for the same vehicle', async () => {
  const entry = {
    id: 'entry-1',
    vehicle_id: 'veh-dedup',
    recorded_at: '2026-01-01T00:00:00Z',
    mileage: 15000,
    source: 'manual',
  }
  mocks.query.range.mockResolvedValueOnce({
    data: [entry],
    error: null,
  })

  const [first, second] = await Promise.all([
    loadVehicleMileageHistory('veh-dedup'),
    loadVehicleMileageHistory('veh-dedup'),
  ])

  expect(first).toEqual([entry])
  expect(second).toEqual([entry])
  expect(mocks.query.range).toHaveBeenCalledTimes(1)
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

it('refreshes history after a save and keeps the newer request deduplicated when the old read finishes', async () => {
  const old = deferred<{ data: VehicleMileageHistory[]; error: null }>()
  const fresh = deferred<{ data: VehicleMileageHistory[]; error: null }>()
  const entry: VehicleMileageHistory = {
    id: 'accepted-update',
    vehicle_id: testVehicle.id,
    recorded_at: '2026-01-01T00:00:00Z',
    mileage: 12500,
    source: 'manual',
  }
  mocks.query.range
    .mockReturnValueOnce(old.promise)
    .mockReturnValueOnce(fresh.promise)
  const oldRead = loadVehicleMileageHistory(testVehicle.id)
  await vi.waitFor(() => expect(mocks.query.range).toHaveBeenCalledTimes(1))
  mocks.rpcSingle.mockResolvedValue({
    data: { ...testVehicle, mileage: 12500 },
    error: null,
  })
  await updateVehicleMileage(testVehicle, 12500)
  const newRead = loadVehicleMileageHistory(testVehicle.id)
  await vi.waitFor(() => expect(mocks.query.range).toHaveBeenCalledTimes(2))
  old.resolve({ data: [], error: null })
  await oldRead
  const duplicate = loadVehicleMileageHistory(testVehicle.id)
  fresh.resolve({ data: [entry], error: null })
  expect(await newRead).toEqual([entry])
  expect(await duplicate).toEqual([entry])
  expect(mocks.query.range).toHaveBeenCalledTimes(2)
})

it('refreshes vehicle reads after a mileage save so notifications use the accepted odometer', async () => {
  const old = deferred<{ data: Vehicle[]; error: null }>()
  const fresh = deferred<{ data: Vehicle[]; error: null }>()
  mocks.query.order
    .mockReturnValueOnce(old.promise)
    .mockReturnValueOnce(fresh.promise)
  const oldRead = listVehicles()
  await vi.waitFor(() => expect(mocks.query.order).toHaveBeenCalledTimes(1))
  mocks.rpcSingle.mockResolvedValue({
    data: { ...testVehicle, mileage: 12500 },
    error: null,
  })
  await updateVehicleMileage(testVehicle, 12500)
  const newRead = listVehicles()
  await vi.waitFor(() => expect(mocks.query.order).toHaveBeenCalledTimes(2))
  old.resolve({ data: [testVehicle], error: null })
  await oldRead
  const duplicate = listVehicles()
  fresh.resolve({ data: [{ ...testVehicle, mileage: 12500 }], error: null })
  const refreshed = (await newRead)[0]
  expect(refreshed.mileage).toBe(12500)
  expect((await duplicate)[0].mileage).toBe(12500)
  expect(mocks.query.order).toHaveBeenCalledTimes(2)
  const items = [
    {
      name: 'Fictional oil change',
      interval_km: 2500,
      interval_months: null,
      enabled: true,
      history_status: 'known' as const,
      last_completed_mileage: 10000,
      last_completed_date: null,
    },
  ]
  expect(aggregateMaintenanceAlerts([{ vehicle: testVehicle, items }])).toEqual(
    { overdue: 0, dueSoon: 0 },
  )
  expect(aggregateMaintenanceAlerts([{ vehicle: refreshed, items }])).toEqual({
    overdue: 1,
    dueSoon: 0,
  })
})

it('clears synchronous history configuration failures so a later read can retry', async () => {
  mocks.fromSelect.mockImplementationOnce(() => {
    throw new Error('Fictional configuration failure')
  })
  await expect(loadVehicleMileageHistory('veh-config')).rejects.toThrow(
    'configuration failure',
  )
  await expect(loadVehicleMileageHistory('veh-config')).resolves.toEqual([])
  expect(mocks.from).toHaveBeenCalledTimes(2)
})

it('does not share a pending history response with another authenticated owner', async () => {
  const old = deferred<{ data: VehicleMileageHistory[]; error: null }>()
  mocks.query.range
    .mockReturnValueOnce(old.promise)
    .mockResolvedValueOnce({ data: [], error: null })
  const firstOwnerRead = loadVehicleMileageHistory(testVehicle.id)
  await vi.waitFor(() => expect(mocks.query.range).toHaveBeenCalledTimes(1))
  mocks.getUser.mockResolvedValue({
    data: { user: { id: 'another-owner' } },
    error: null,
  })
  const nextOwnerRead = loadVehicleMileageHistory(testVehicle.id)
  old.resolve({
    data: [
      {
        id: 'private-history',
        vehicle_id: testVehicle.id,
        recorded_at: '2026-01-01T00:00:00Z',
        mileage: 10000,
        source: 'manual',
      },
    ],
    error: null,
  })
  expect(await firstOwnerRead).toHaveLength(1)
  expect(await nextOwnerRead).toEqual([])
  expect(mocks.query.range).toHaveBeenCalledTimes(2)
})

it('does not share a pending vehicle list across authenticated owners', async () => {
  const old = deferred<{ data: Vehicle[]; error: null }>()
  mocks.query.order
    .mockReturnValueOnce(old.promise)
    .mockResolvedValueOnce({ data: [], error: null })
  const firstOwnerRead = listVehicles()
  await vi.waitFor(() => expect(mocks.query.order).toHaveBeenCalledTimes(1))
  mocks.getUser.mockResolvedValue({
    data: { user: { id: 'another-owner' } },
    error: null,
  })
  const nextOwnerRead = listVehicles()
  old.resolve({ data: [testVehicle], error: null })
  expect(await firstOwnerRead).toEqual([testVehicle])
  expect(await nextOwnerRead).toEqual([])
  expect(mocks.query.order).toHaveBeenCalledTimes(2)
})

it('does not reuse history or vehicle reads after signing out', async () => {
  mocks.getUser.mockResolvedValue({ data: { user: null }, error: null })
  await expect(loadVehicleMileageHistory(testVehicle.id)).rejects.toThrow(
    'Sign in',
  )
  await expect(listVehicles()).rejects.toThrow('Sign in')
  expect(mocks.from).not.toHaveBeenCalled()
})

it('invalidates pending history and notifies maintenance when the vehicle editor saves mileage', async () => {
  const old = deferred<{ data: VehicleMileageHistory[]; error: null }>()
  mocks.query.range
    .mockReturnValueOnce(old.promise)
    .mockResolvedValueOnce({ data: [], error: null })
  const oldRead = loadVehicleMileageHistory(testVehicle.id)
  await vi.waitFor(() => expect(mocks.query.range).toHaveBeenCalledTimes(1))
  mocks.query.single.mockResolvedValue({
    data: { ...testVehicle, mileage: 12500 },
    error: null,
  })
  const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
  await saveVehicle({ ...input, mileage: 12500 }, testVehicle.id)
  const refreshed = loadVehicleMileageHistory(testVehicle.id)
  old.resolve({ data: [], error: null })
  await oldRead
  await refreshed
  expect(mocks.query.range).toHaveBeenCalledTimes(2)
  expect(dispatchSpy).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'app:maintenance-change' }),
  )
  expect(dispatchSpy).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'app:vehicle-change' }),
  )
  dispatchSpy.mockRestore()
})
