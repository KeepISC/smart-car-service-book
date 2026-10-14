import { beforeEach, expect, it, vi } from 'vitest'
import type { ShopStaffRole } from '../types/repairShop'

const mock = vi.hoisted(() => ({
  rpc: vi.fn(),
  notify: vi.fn(),
  enabled: true,
}))
vi.mock('./supabase', () => ({ client: () => ({ rpc: mock.rpc }) }))
vi.mock('./maintenanceChanges', () => ({
  notifyMaintenanceChange: mock.notify,
}))
vi.mock('../config/features', () => ({
  isServiceHistoryEnabled: () => mock.enabled,
}))
import {
  approveVehicleShopAuthorization,
  createRepairShop,
  createRepairShopServiceVisit,
  getRepairShopVehicle,
  listRepairShopAuthorizations,
  listRepairShops,
  listRepairShopStaff,
  listVehicleShopAuthorizations,
  requestRepairShopMembership,
  requestVehicleShopAuthorization,
  revokeVehicleShopAuthorization,
  setRepairShopStaff,
} from './repairShops'

beforeEach(() => {
  vi.clearAllMocks()
  mock.enabled = true
  mock.rpc.mockResolvedValue({ data: null, error: null })
})

it('creates a shop and requests membership without a caller-selected identity', async () => {
  mock.rpc.mockResolvedValueOnce({ data: 'shop', error: null })
  await expect(createRepairShop('  Fictional shop  ')).resolves.toBe('shop')
  expect(mock.rpc).toHaveBeenCalledWith('create_repair_shop', {
    p_name: 'Fictional shop',
  })
  await requestRepairShopMembership('shop')
  expect(mock.rpc).toHaveBeenLastCalledWith('request_repair_shop_membership', {
    p_shop_id: 'shop',
  })
})

it('requires valid profiles, roles and an explicit record permission', async () => {
  await expect(createRepairShop(' ')).rejects.toThrow('name')
  await expect(createRepairShop('a'.repeat(121))).rejects.toThrow('name')
  await expect(
    setRepairShopStaff('shop', 'member', 'owner' as ShopStaffRole),
  ).rejects.toThrow('Choose')
  await expect(
    approveVehicleShopAuthorization(
      'vehicle',
      'grant',
      undefined as unknown as boolean,
    ),
  ).rejects.toThrow('Choose')
  expect(mock.rpc).not.toHaveBeenCalled()
})

it('separates request, owner approval, revocation and staff removal', async () => {
  mock.rpc.mockResolvedValueOnce({ data: 'grant', error: null })
  await expect(
    requestVehicleShopAuthorization('vehicle', 'shop'),
  ).resolves.toBe('grant')
  expect(mock.rpc).toHaveBeenLastCalledWith(
    'request_vehicle_shop_authorization',
    { p_vehicle_id: 'vehicle', p_shop_id: 'shop' },
  )
  await approveVehicleShopAuthorization('vehicle', 'grant', false)
  expect(mock.rpc).toHaveBeenLastCalledWith(
    'approve_vehicle_shop_authorization',
    {
      p_vehicle_id: 'vehicle',
      p_authorization_id: 'grant',
      p_can_create_records: false,
    },
  )
  await revokeVehicleShopAuthorization('vehicle', 'grant')
  expect(mock.rpc).toHaveBeenLastCalledWith(
    'revoke_vehicle_shop_authorization',
    { p_vehicle_id: 'vehicle', p_authorization_id: 'grant' },
  )
  await setRepairShopStaff('shop', 'member', 'mechanic')
  await setRepairShopStaff('shop', 'member', null)
  expect(mock.rpc).toHaveBeenLastCalledWith('set_repair_shop_staff', {
    p_shop_id: 'shop',
    p_member_id: 'member',
    p_role: null,
  })
})

it('uses RPCs for scoped lists and sanitized customer data', async () => {
  for (const load of [
    listRepairShops,
    () => listRepairShopStaff('shop'),
    () => listRepairShopAuthorizations('shop'),
    () => listVehicleShopAuthorizations('vehicle'),
  ]) {
    mock.rpc.mockResolvedValueOnce({ data: [], error: null })
    await expect(load()).resolves.toEqual([])
  }
  const data = {
    vehicle: { id: 'vehicle' },
    maintenance_schedules: [],
    maintenance_records: [],
  }
  mock.rpc.mockResolvedValueOnce({ data, error: null })
  await expect(getRepairShopVehicle('shop', 'vehicle')).resolves.toEqual(data)
  expect(mock.rpc).toHaveBeenLastCalledWith('get_repair_shop_vehicle', {
    p_shop_id: 'shop',
    p_vehicle_id: 'vehicle',
  })
})

const input = {
  service_date: '2026-01-31',
  mileage: 1000,
  notes: null,
  total_cost: null,
  operations: [
    { maintenance_item_id: null, operation_name: 'Oil', cost: null },
  ],
}
it('creates append-only workshop records and notifies only after confirmation', async () => {
  mock.rpc.mockResolvedValueOnce({ data: 'visit', error: null })
  await expect(
    createRepairShopServiceVisit('shop', 'vehicle', input),
  ).resolves.toBe('visit')
  expect(mock.rpc).toHaveBeenLastCalledWith(
    'create_repair_shop_service_visit',
    { p_shop_id: 'shop', p_vehicle_id: 'vehicle', p_payload: input },
  )
  expect(mock.notify).toHaveBeenCalledOnce()
  mock.enabled = false
  await expect(
    createRepairShopServiceVisit('shop', 'vehicle', input),
  ).rejects.toThrow('not enabled')
  expect(mock.rpc).toHaveBeenCalledTimes(1)
})

it('preserves revocation and serialization errors without retry or success notification', async () => {
  for (const code of ['42501', '40001']) {
    const error = { code, message: 'Denied' }
    for (const action of [
      () => getRepairShopVehicle('shop', 'vehicle'),
      () => approveVehicleShopAuthorization('vehicle', 'grant', true),
      () => createRepairShopServiceVisit('shop', 'vehicle', input),
    ]) {
      mock.rpc.mockResolvedValueOnce({ data: null, error })
      await expect(action()).rejects.toEqual(error)
    }
  }
  expect(mock.rpc).toHaveBeenCalledTimes(6)
  expect(mock.notify).not.toHaveBeenCalled()
})

it('does not accept malformed success responses', async () => {
  await expect(createRepairShop('Shop')).rejects.toThrow('not completed')
  await expect(
    requestVehicleShopAuthorization('vehicle', 'shop'),
  ).rejects.toThrow('not completed')
  await expect(listRepairShops()).rejects.toThrow('unavailable')
  await expect(getRepairShopVehicle('shop', 'vehicle')).rejects.toThrow(
    'unavailable',
  )
  await expect(
    createRepairShopServiceVisit('shop', 'vehicle', input),
  ).rejects.toThrow('not completed')
  expect(mock.notify).not.toHaveBeenCalled()
})
