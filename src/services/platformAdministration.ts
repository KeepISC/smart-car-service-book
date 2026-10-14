import { client } from './supabase'
import type {
  PlatformRepairShop,
  PlatformShopAudit,
  ShopBrandingInput,
  ShopSubscriptionInput,
  PlatformShopSearchPage,
  PlatformShopAdministrator,
  ProvisionedAdministratorCandidate,
} from '../types/platformAdministration'

async function call(name: string, parameters?: Record<string, unknown>) {
  const { data, error } = await client().rpc(name, parameters)
  // Every RPC checks current platform membership; never trust a cached UI role.
  if (error) throw error
  return data
}

function reasonText(reason: string) {
  const trimmed = reason.trim()
  if (!trimmed || trimmed.length > 1000)
    throw new Error(
      'Provide an administration reason of 1 to 1,000 characters.',
    )
  return trimmed
}

function profileInput(profile: ShopBrandingInput): ShopBrandingInput {
  const name = profile.business_name.trim()
  if (!name || name.length > 120)
    throw new Error('Business name must contain 1 to 120 characters.')
  return { ...profile, business_name: name }
}

function page(offset: number, limit: number) {
  if (
    !Number.isInteger(offset) ||
    offset < 0 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 200
  )
    throw new Error('Choose a valid administration page.')
  return { p_offset: offset, p_limit: limit }
}

export async function isPlatformAdministrator(): Promise<boolean> {
  const data = await call('is_platform_administrator')
  if (typeof data !== 'boolean')
    throw new Error('Platform administration status is unavailable.')
  return data
}

export async function platformCreateRepairShop(
  profile: ShopBrandingInput,
  reason: string,
): Promise<string> {
  const data = await call('platform_create_repair_shop', {
    p_profile: profileInput(profile),
    p_reason: reasonText(reason),
  })
  if (typeof data !== 'string' || !data)
    throw new Error('The shop was not created.')
  return data
}

// Profile and subscription changes replace their own fields, preserving all others.
export async function platformUpdateRepairShop(
  shopId: string,
  profile: ShopBrandingInput,
  reason: string,
) {
  await call('platform_update_repair_shop', {
    p_shop_id: shopId,
    p_profile: profileInput(profile),
    p_reason: reasonText(reason),
  })
}

export async function platformSetShopSuspension(
  shopId: string,
  suspended: boolean,
  reason: string,
) {
  if (typeof suspended !== 'boolean')
    throw new Error('Choose suspension status.')
  await call('platform_set_shop_suspension', {
    p_shop_id: shopId,
    p_suspended: suspended,
    p_reason: reasonText(reason),
  })
}

export async function platformSetShopSubscription(
  shopId: string,
  subscription: ShopSubscriptionInput,
  reason: string,
) {
  const start =
    subscription.starts_at === null ? null : Date.parse(subscription.starts_at)
  const end =
    subscription.ends_at === null ? null : Date.parse(subscription.ends_at)
  if (
    !/^[a-z0-9][a-z0-9_-]{0,39}$/.test(subscription.plan_code) ||
    !['pending', 'active', 'disabled'].includes(subscription.status) ||
    (start !== null && !Number.isFinite(start)) ||
    (end !== null && !Number.isFinite(end)) ||
    (start !== null && end !== null && end <= start) ||
    (subscription.status === 'active' && (start === null || end === null)) ||
    Object.values(subscription.limits).some(
      (value) =>
        value !== null &&
        (!Number.isInteger(value) || value < 0 || value > 2147483647),
    )
  )
    throw new Error('Review the subscription dates, status and limits.')
  await call('platform_set_shop_subscription', {
    p_shop_id: shopId,
    p_subscription: subscription,
    p_reason: reasonText(reason),
  })
}

export async function platformSetShopAdministrator(
  shopId: string,
  firebaseUid: string,
  enabled: boolean,
  reason: string,
) {
  if (!firebaseUid || firebaseUid.length > 128 || typeof enabled !== 'boolean')
    throw new Error(
      'Choose an existing Firebase identity and administrator access.',
    )
  await call('platform_set_shop_administrator', {
    p_shop_id: shopId,
    p_firebase_uid: firebaseUid,
    p_enabled: enabled,
    p_reason: reasonText(reason),
  })
}

export async function platformListRepairShops(
  offset = 0,
  limit = 100,
): Promise<PlatformRepairShop[]> {
  const data = await call('platform_list_repair_shops', page(offset, limit))
  if (!Array.isArray(data))
    throw new Error('Platform shop records are unavailable.')
  return data as PlatformRepairShop[]
}

export async function platformListShopAudit(
  shopId: string | null = null,
  offset = 0,
  limit = 100,
): Promise<PlatformShopAudit[]> {
  const data = await call('platform_list_shop_audit', {
    p_shop_id: shopId,
    ...page(offset, limit),
  })
  if (!Array.isArray(data))
    throw new Error('Platform audit records are unavailable.')
  return data as PlatformShopAudit[]
}

function searchPage<T>(data: unknown): PlatformShopSearchPage<T> {
  const result = data as PlatformShopSearchPage<T> | null
  if (
    !result ||
    !Array.isArray(result.items) ||
    !Number.isInteger(result.total) ||
    result.total < 0 ||
    !Number.isInteger(result.offset) ||
    result.offset < 0 ||
    !Number.isInteger(result.limit) ||
    result.limit < 1
  )
    throw new Error('Search results are unavailable.')
  return result
}

export async function platformSearchRepairShops(
  search = '',
  status: PlatformRepairShop['access_status'] | null = null,
  offset = 0,
  limit = 100,
): Promise<PlatformShopSearchPage<PlatformRepairShop>> {
  if (
    search.length > 128 ||
    (status !== null &&
      ![
        'pending',
        'active',
        'disabled',
        'suspended',
        'not_started',
        'expired',
      ].includes(status))
  )
    throw new Error('Choose a valid shop search and status.')
  return searchPage(
    await call('platform_search_repair_shops', {
      p_search: search.trim(),
      p_status: status,
      ...page(offset, limit),
    }),
  )
}

export async function platformListShopAdministrators(
  shopId: string,
): Promise<PlatformShopAdministrator[]> {
  const data = await call('platform_list_shop_administrators', {
    p_shop_id: shopId,
  })
  if (!Array.isArray(data))
    throw new Error('Shop administrators are unavailable.')
  return data
}

export async function platformFindProvisionedUsers(
  search: string,
  offset = 0,
  limit = 20,
): Promise<PlatformShopSearchPage<ProvisionedAdministratorCandidate>> {
  if (search.trim().length < 3 || search.trim().length > 128 || limit > 50)
    throw new Error(
      'Enter a UID search of 3 to 128 characters and a valid page.',
    )
  return searchPage(
    await call('platform_find_provisioned_users', {
      p_search: search.trim(),
      ...page(offset, limit),
    }),
  )
}
