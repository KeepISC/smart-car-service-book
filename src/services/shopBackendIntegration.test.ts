import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), notify: vi.fn() }))
vi.mock('./supabase', () => ({ client: () => ({ rpc: mocks.rpc }) }))
vi.mock('./maintenanceChanges', () => ({
  notifyMaintenanceChange: mocks.notify,
}))
import {
  platformSearchRepairShops,
  platformListShopAdministrators,
  platformFindProvisionedUsers,
} from './platformAdministration'
import {
  searchAvailableRepairShops,
  reviewOwnerShopRequest,
  setVehicleShopDataSharing,
  getRepairShopVehicle,
} from './repairShops'
beforeEach(() => {
  vi.resetAllMocks()
  mocks.rpc.mockResolvedValue({ data: null, error: null })
})
const page = { items: [], total: 12, offset: 20, limit: 10 }
it('searches and filters platform shops server-side while retaining out-of-range totals', async () => {
  mocks.rpc.mockResolvedValue({ data: page, error: null })
  await expect(
    platformSearchRepairShops(' Garage ', 'expired', 20, 10),
  ).resolves.toEqual(page)
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith(
    'platform_search_repair_shops',
    { p_search: 'Garage', p_status: 'expired', p_offset: 20, p_limit: 10 },
  )
})
it('looks up provisioned UIDs and current administrators without selected actor/owner IDs', async () => {
  mocks.rpc.mockResolvedValueOnce({
    data: [{ firebase_uid: 'fictional-uid', enabled: false }],
    error: null,
  })
  await expect(platformListShopAdministrators('shop')).resolves.toEqual([
    { firebase_uid: 'fictional-uid', enabled: false },
  ])
  expect(mocks.rpc).toHaveBeenLastCalledWith(
    'platform_list_shop_administrators',
    { p_shop_id: 'shop' },
  )
  mocks.rpc.mockResolvedValueOnce({ data: page, error: null })
  await platformFindProvisionedUsers(' fictional ', 20, 10)
  expect(mocks.rpc).toHaveBeenLastCalledWith(
    'platform_find_provisioned_users',
    { p_search: 'fictional', p_offset: 20, p_limit: 10 },
  )
})
it('searches the eligible directory for an owned vehicle through an RPC', async () => {
  mocks.rpc.mockResolvedValue({ data: page, error: null })
  await expect(
    searchAvailableRepairShops('vehicle', ' Town ', 20, 10),
  ).resolves.toEqual(page)
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith(
    'search_available_repair_shops',
    { p_vehicle_id: 'vehicle', p_search: 'Town', p_offset: 20, p_limit: 10 },
  )
})
it('reviews requests separately from mandatory owner approval', async () => {
  for (const outcome of ['accepted', 'declined'] as const) {
    await reviewOwnerShopRequest('vehicle', 'authorization', outcome)
    expect(mocks.rpc).toHaveBeenLastCalledWith('review_owner_shop_request', {
      p_vehicle_id: 'vehicle',
      p_authorization_id: 'authorization',
      p_outcome: outcome,
    })
  }
  expect(mocks.rpc).toHaveBeenCalledTimes(2)
  expect(mocks.notify).toHaveBeenCalledTimes(2)
})
it('sets explicit sharing choices with no chosen identity, provenance or authorization upgrade', async () => {
  await setVehicleShopDataSharing('vehicle', 'authorization', {
    customer_reference: ' Customer alias ',
    share_operation_names: true,
    shared_visit_ids: ['visit'],
  })
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith(
    'set_vehicle_shop_data_sharing',
    {
      p_vehicle_id: 'vehicle',
      p_authorization_id: 'authorization',
      p_customer_reference: 'Customer alias',
      p_share_operation_names: true,
      p_shared_visit_ids: ['visit'],
    },
  )
  expect(mocks.notify).toHaveBeenCalledOnce()
})
it('keeps authorized rich projection fields returned by the existing CRM RPC', async () => {
  const data = {
    customer_reference: 'Customer alias',
    vehicle: { id: 'vehicle' },
    maintenance_schedules: [{ id: 'schedule', name: 'Oil' }],
    maintenance_records: [
      {
        id: 'visit',
        notes: 'Shared note',
        total_cost: 50,
        workshop_provenance: {
          shop_id: 'shop',
          shop_name: 'Fictional garage',
          recorded_at: '2026-01-01',
        },
      },
    ],
  }
  mocks.rpc.mockResolvedValue({ data, error: null })
  await expect(getRepairShopVehicle('shop', 'vehicle')).resolves.toEqual(data)
})
it('rejects invalid search, pagination and sharing choices before sending requests', async () => {
  await expect(platformSearchRepairShops('x'.repeat(129))).rejects.toThrow(
    'search',
  )
  await expect(platformSearchRepairShops('', null, -1)).rejects.toThrow('page')
  await expect(platformFindProvisionedUsers('ab')).rejects.toThrow('UID')
  await expect(platformFindProvisionedUsers('abc', 0, 51)).rejects.toThrow(
    'page',
  )
  await expect(
    searchAvailableRepairShops('vehicle', '', 0, 101),
  ).rejects.toThrow('page')
  await expect(searchAvailableRepairShops('vehicle', '', 0.5)).rejects.toThrow(
    'page',
  )
  await expect(
    setVehicleShopDataSharing('v', 'a', {
      customer_reference: ' ',
      share_operation_names: true,
      shared_visit_ids: [],
    }),
  ).rejects.toThrow('sharing')
  await expect(
    setVehicleShopDataSharing('v', 'a', {
      customer_reference: null,
      share_operation_names: true,
      shared_visit_ids: Array(1001).fill('visit'),
    }),
  ).rejects.toThrow('sharing')
  expect(mocks.rpc).not.toHaveBeenCalled()
})
it.each(['42501', '40001', '23514'])(
  'preserves %s errors without retrying or announcing a successful mutation',
  async (code) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code } })
    for (const call of [
      () => platformSearchRepairShops(),
      () => platformFindProvisionedUsers('fictional'),
      () => platformListShopAdministrators('shop'),
      () => searchAvailableRepairShops('vehicle'),
      () => reviewOwnerShopRequest('v', 'a', 'accepted'),
      () =>
        setVehicleShopDataSharing('v', 'a', {
          customer_reference: null,
          share_operation_names: false,
          shared_visit_ids: [],
        }),
    ])
      await expect(call()).rejects.toEqual({ code })
    expect(mocks.rpc).toHaveBeenCalledTimes(6)
    expect(mocks.notify).not.toHaveBeenCalled()
  },
)
it('rejects malformed search and administrator results', async () => {
  for (const call of [
    () => platformSearchRepairShops(),
    () => platformFindProvisionedUsers('fictional'),
    () => platformListShopAdministrators('shop'),
    () => searchAvailableRepairShops('vehicle'),
  ])
    await expect(call()).rejects.toThrow('unavailable')
})
