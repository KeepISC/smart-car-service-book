import { beforeEach, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('./supabase', () => ({ client: () => ({ rpc: mock.rpc }) }))
import {
  isPlatformAdministrator,
  platformCreateRepairShop,
  platformListRepairShops,
  platformListShopAudit,
  platformSetShopAdministrator,
  platformSetShopSubscription,
  platformSetShopSuspension,
  platformUpdateRepairShop,
} from './platformAdministration'
const profile = {
  business_name: ' Fictional shop ',
  logo_reference: 'logos/fictional',
  primary_color: '#112233',
  secondary_color: null,
  contact_email: 'shop@example.test',
  contact_phone: null,
  contact_address: null,
  contact_website: null,
}
const subscription = {
  plan_code: 'manual-basic',
  status: 'active' as const,
  starts_at: '2026-01-01T00:00:00Z',
  ends_at: '2027-01-01T00:00:00Z',
  limits: {
    max_active_staff: 3,
    max_connected_vehicles: 10,
    max_monthly_records: 20,
  },
}
beforeEach(() => {
  vi.clearAllMocks()
  mock.rpc.mockResolvedValue({ data: null, error: null })
})

it('reads platform status without accepting an identity or role', async () => {
  mock.rpc.mockResolvedValueOnce({ data: false, error: null })
  await expect(isPlatformAdministrator()).resolves.toBe(false)
  expect(mock.rpc).toHaveBeenLastCalledWith(
    'is_platform_administrator',
    undefined,
  )
})
it('creates and updates branding with an audit reason and no chosen actor', async () => {
  mock.rpc.mockResolvedValueOnce({ data: 'shop', error: null })
  await expect(
    platformCreateRepairShop(profile, ' Provision shop '),
  ).resolves.toBe('shop')
  expect(mock.rpc).toHaveBeenLastCalledWith('platform_create_repair_shop', {
    p_profile: { ...profile, business_name: 'Fictional shop' },
    p_reason: 'Provision shop',
  })
  await platformUpdateRepairShop('shop', profile, 'Change branding')
  expect(mock.rpc).toHaveBeenLastCalledWith('platform_update_repair_shop', {
    p_shop_id: 'shop',
    p_profile: { ...profile, business_name: 'Fictional shop' },
    p_reason: 'Change branding',
  })
})
it('separates administrative suspension, subscription and shop administrator membership', async () => {
  await platformSetShopSuspension('shop', true, 'Suspend')
  expect(mock.rpc).toHaveBeenLastCalledWith('platform_set_shop_suspension', {
    p_shop_id: 'shop',
    p_suspended: true,
    p_reason: 'Suspend',
  })
  await platformSetShopSubscription('shop', subscription, 'Manual plan')
  expect(mock.rpc).toHaveBeenLastCalledWith('platform_set_shop_subscription', {
    p_shop_id: 'shop',
    p_subscription: subscription,
    p_reason: 'Manual plan',
  })
  await platformSetShopAdministrator(
    'shop',
    'existing-firebase-uid',
    false,
    'Revoke admin',
  )
  expect(mock.rpc).toHaveBeenLastCalledWith('platform_set_shop_administrator', {
    p_shop_id: 'shop',
    p_firebase_uid: 'existing-firebase-uid',
    p_enabled: false,
    p_reason: 'Revoke admin',
  })
})
it('rejects missing reasons, invalid windows and quota values before mutation', async () => {
  await expect(platformCreateRepairShop(profile, ' ')).rejects.toThrow('reason')
  await expect(
    platformCreateRepairShop({ ...profile, business_name: ' ' }, 'Create'),
  ).rejects.toThrow('name')
  for (const invalid of [
    { ...subscription, starts_at: null },
    { ...subscription, ends_at: 'invalid' },
    { ...subscription, ends_at: subscription.starts_at },
    {
      ...subscription,
      limits: { ...subscription.limits, max_active_staff: -1 },
    },
    {
      ...subscription,
      limits: { ...subscription.limits, max_monthly_records: 1.5 },
    },
  ])
    await expect(
      platformSetShopSubscription('shop', invalid, 'Plan'),
    ).rejects.toThrow('subscription')
  expect(mock.rpc).not.toHaveBeenCalled()
})
it('bounds administration and audit pages', async () => {
  mock.rpc.mockResolvedValueOnce({ data: [], error: null })
  await expect(platformListRepairShops()).resolves.toEqual([])
  expect(mock.rpc).toHaveBeenLastCalledWith('platform_list_repair_shops', {
    p_offset: 0,
    p_limit: 100,
  })
  mock.rpc.mockResolvedValueOnce({ data: [], error: null })
  await expect(platformListShopAudit('shop', 10, 20)).resolves.toEqual([])
  expect(mock.rpc).toHaveBeenLastCalledWith('platform_list_shop_audit', {
    p_shop_id: 'shop',
    p_offset: 10,
    p_limit: 20,
  })
  await expect(platformListRepairShops(-1)).rejects.toThrow('page')
  await expect(platformListShopAudit(null, 0, 201)).rejects.toThrow('page')
  expect(mock.rpc).toHaveBeenCalledTimes(2)
})
it('preserves authorization and serialization errors without retrying administrative actions', async () => {
  for (const code of ['42501', '40001']) {
    const error = { code, message: 'Denied' }
    mock.rpc.mockResolvedValueOnce({ data: null, error })
    await expect(
      platformSetShopSuspension('shop', false, 'Reactivate'),
    ).rejects.toEqual(error)
  }
  expect(mock.rpc).toHaveBeenCalledTimes(2)
})
it('rejects malformed status, creation and list responses', async () => {
  await expect(isPlatformAdministrator()).rejects.toThrow('unavailable')
  await expect(platformCreateRepairShop(profile, 'Create')).rejects.toThrow(
    'not created',
  )
  await expect(platformListRepairShops()).rejects.toThrow('unavailable')
  await expect(platformListShopAudit()).rejects.toThrow('unavailable')
})
