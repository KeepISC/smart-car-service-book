import type { PlatformRepairShop } from '../types/platformAdministration'

export function errorCode(error: unknown) {
  return typeof error === 'object' && error && 'code' in error
    ? String((error as { code: unknown }).code)
    : ''
}

// Server errors are never echoed. Service-level validation errors carry no
// database code and are safe, user-actionable text.
export function describeError(error: unknown) {
  const code = errorCode(error)
  if (code === '42501')
    return 'Permission denied. Platform administrator access is required.'
  if (code === '40001')
    return 'Another change happened at the same time. Reload and try again.'
  if (!code && error instanceof Error && error.message) return error.message
  return 'Unable to complete that action. Please try again.'
}

export function toLocalInput(value: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

export function fromLocalInput(value: string) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toISOString()
}

export function formatDateTime(value: string | null) {
  if (!value) return 'Not set'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

export const accessLabels: Record<PlatformRepairShop['access_status'], string> =
  {
    active: 'Active',
    pending: 'Pending subscription',
    disabled: 'Subscription disabled',
    suspended: 'Suspended',
    not_started: 'Not started',
    expired: 'Expired',
  }
