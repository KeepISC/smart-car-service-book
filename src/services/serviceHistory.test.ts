import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Vehicle } from '../types/vehicle'
import type { ServiceVisitInput } from '../types/serviceHistory'

const mock = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  current: { data: null as unknown, error: null as Error | null },
  results: [] as Array<{ data: unknown; error: Error | null }>,
  query: {
    eq: vi.fn(),
    order: vi.fn(),
    select: vi.fn(),
    in: vi.fn(),
    then: vi.fn(),
    range: vi.fn(),
  },
}))
vi.mock('./supabase', () => ({
  client: () => ({ rpc: mock.rpc, from: mock.from }),
}))
import {
  deleteServiceVisit,
  loadServiceHistory,
  saveServiceVisit,
} from './serviceHistory'

const vehicle = {
  id: 'fictional-vehicle',
  mileage: 20000,
} as Vehicle
const input: ServiceVisitInput = {
  service_date: '2026-10-01',
  mileage: 10000,
  service_type: 'diy',
  workshop_name: null,
  total_cost: null,
  notes: null,
  operations: [
    {
      maintenance_item_id: 'fictional-schedule',
      operation_name: 'Fictional maintenance',
      cost: null,
      next_interval_km: null,
      next_interval_months: null,
    },
  ],
}
beforeEach(() => {
  vi.stubEnv('VITE_SERVICE_HISTORY_ENABLED', 'true')
  vi.clearAllMocks()
  for (const method of ['eq', 'order', 'select', 'in', 'range'] as const)
    mock.query[method].mockReturnValue(mock.query)
  mock.query.then.mockImplementation((resolve) => resolve(mock.current))
  mock.from.mockImplementation(() => {
    mock.current = mock.results.shift() ?? { data: [], error: null }
    return mock.query
  })
  mock.results = []
  mock.rpc.mockResolvedValue({ data: 'fictional-visit', error: null })
})
afterEach(() => vi.unstubAllEnvs())

it('notifies alerts after Service History saves and deletes, but not failures', async () => {
  const listener = vi.fn()
  window.addEventListener('app:maintenance-change', listener)
  try {
    await saveServiceVisit(vehicle, input)
    await saveServiceVisit(vehicle, input, 'fictional-visit')
    await deleteServiceVisit(vehicle.id, 'fictional-visit')
    expect(listener).toHaveBeenCalledTimes(3)
    mock.rpc.mockResolvedValueOnce({ data: null, error: new Error('Offline') })
    await expect(
      deleteServiceVisit(vehicle.id, 'fictional-visit'),
    ).rejects.toThrow()
    expect(listener).toHaveBeenCalledTimes(3)
  } finally {
    window.removeEventListener('app:maintenance-change', listener)
  }
})

it('does not query or mutate Service History when its flag is disabled', async () => {
  vi.stubEnv('VITE_SERVICE_HISTORY_ENABLED', 'false')
  await expect(loadServiceHistory(vehicle.id)).rejects.toThrow('not enabled')
  await expect(saveServiceVisit(vehicle, input)).rejects.toThrow('not enabled')
  await expect(
    deleteServiceVisit(vehicle.id, 'fictional-visit'),
  ).rejects.toThrow('not enabled')
  expect(mock.from).not.toHaveBeenCalled()
  expect(mock.rpc).not.toHaveBeenCalled()
})

it('creates a DIY visit through the atomic database function, without owner input', async () => {
  await expect(saveServiceVisit(vehicle, input)).resolves.toBe(
    'fictional-visit',
  )
  expect(mock.rpc).toHaveBeenCalledWith('save_service_visit', {
    p_vehicle_id: vehicle.id,
    p_visit_id: null,
    p_payload: input,
  })
})

it('edits an existing visit atomically and rejects an empty response', async () => {
  await saveServiceVisit(vehicle, input, 'fictional-visit')
  expect(mock.rpc).toHaveBeenCalledWith(
    'save_service_visit',
    expect.objectContaining({ p_visit_id: 'fictional-visit' }),
  )
  mock.rpc.mockResolvedValueOnce({ data: null, error: null })
  await expect(saveServiceVisit(vehicle, input)).rejects.toThrow('not saved')
})

it('deletes a visit using both the vehicle and visit identifiers', async () => {
  await deleteServiceVisit(vehicle.id, 'fictional-visit')
  expect(mock.rpc).toHaveBeenCalledWith('delete_service_visit', {
    p_vehicle_id: vehicle.id,
    p_visit_id: 'fictional-visit',
  })
})

it('lists visits with their nested operations', async () => {
  const visits = [
    {
      id: 'fictional-visit',
      vehicle_id: vehicle.id,
      service_date: '2026-10-01',
      mileage: 10000,
      service_type: 'workshop',
      workshop_name: 'Fictional garage',
      total_cost: 20,
      notes: null,
      created_at: '2026-10-01T12:00:00Z',
      updated_at: '2026-10-01T12:00:00Z',
    },
  ]
  const operation = {
    id: 'fictional-operation',
    service_visit_id: 'fictional-visit',
    maintenance_item_id: null,
    operation_name: 'Fictional custom task',
    cost: null,
    next_interval_km: null,
    next_interval_months: null,
    created_at: '2026-10-01T12:00:00Z',
    updated_at: '2026-10-01T12:00:00Z',
  }
  mock.results = [
    {
      data: [{ ...visits[0], service_operations: [operation] }],
      error: null,
    },
  ]
  await expect(loadServiceHistory(vehicle.id)).resolves.toEqual([
    { ...visits[0], operations: [operation] },
  ])
})

it('surfaces a failed atomic database operation', async () => {
  mock.rpc.mockResolvedValueOnce({
    data: null,
    error: new Error('permission denied'),
  })
  await expect(saveServiceVisit(vehicle, input)).rejects.toThrow(
    'permission denied',
  )
})

it('loads history beyond the API page limit rather than dropping older linked work', async () => {
  mock.results = [
    {
      data: Array.from({ length: 500 }, (_, index) => ({
        id: `visit-${index}`,
        service_operations: [],
      })),
      error: null,
    },
    {
      data: [
        {
          id: 'older-linked-visit',
          service_operations: [
            { id: 'older-operation', maintenance_item_id: 'schedule' },
          ],
        },
      ],
      error: null,
    },
  ]
  const history = await loadServiceHistory(vehicle.id)
  expect(history).toHaveLength(501)
  expect(history[500].operations[0].maintenance_item_id).toBe('schedule')
  expect(mock.query.range.mock.calls).toEqual([
    [0, 499],
    [500, 999],
  ])
})
