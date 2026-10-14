export type ShopBrandingInput = {
  business_name: string
  logo_reference: string | null
  primary_color: string | null
  secondary_color: string | null
  contact_email: string | null
  contact_phone: string | null
  contact_address: string | null
  contact_website: string | null
}

export type ShopSubscriptionInput = {
  plan_code: string
  status: 'pending' | 'active' | 'disabled'
  starts_at: string | null
  ends_at: string | null
  limits: {
    max_active_staff: number | null
    max_connected_vehicles: number | null
    max_monthly_records: number | null
  }
}

export type PlatformRepairShop = Omit<ShopBrandingInput, 'business_name'> & {
  id: string
  name: string
  created_at: string
  suspended: boolean
  plan_code: string
  subscription_status: ShopSubscriptionInput['status']
  subscription_starts_at: string | null
  subscription_ends_at: string | null
  max_active_staff: number | null
  max_connected_vehicles: number | null
  max_monthly_records: number | null
  access_status:
    'pending' | 'active' | 'disabled' | 'suspended' | 'not_started' | 'expired'
}

export type PlatformShopAudit = {
  id: string
  occurred_at: string
  actor_id: string | null
  executor: string
  shop_id: string | null
  action: string
  reason: string
  before_state: Record<string, unknown> | null
  after_state: Record<string, unknown> | null
}

export type PlatformShopAdministrator = {
  firebase_uid: string
  enabled: boolean
}
export type ProvisionedAdministratorCandidate = { firebase_uid: string }
export type PlatformShopSearchPage<T> = {
  items: T[]
  total: number
  offset: number
  limit: number
}
