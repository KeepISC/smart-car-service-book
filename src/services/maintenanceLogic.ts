import type { MaintenanceInput } from '../types/maintenance'
export type MaintenanceStatus =
  | 'Up to date'
  | 'Due soon'
  | 'Due / overdue'
  | 'Unknown'
  | 'Disabled'
  | 'Not applicable'
export function dateOnly(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
function parseDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const parsed = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
    ? parsed
    : null
}
export function addCalendarMonths(
  value: string,
  months: number,
): string | null {
  const date = parseDate(value)
  if (!date || !Number.isInteger(months) || months < 1) return null
  // Calendar intervals clamp month-end dates instead of overflowing into another month.
  const target = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1),
  )
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate()
  target.setUTCDate(Math.min(date.getUTCDate(), lastDay))
  return target.toISOString().slice(0, 10)
}
export function calculateMaintenance(
  item: MaintenanceInput,
  mileage: number,
  today = dateOnly(),
) {
  const result: {
    status: MaintenanceStatus
    nextMileage: number | null
    nextDate: string | null
    partialHistory: boolean
  } = {
    status: 'Unknown',
    nextMileage: null,
    nextDate: null,
    partialHistory: false,
  }
  if (!item.enabled) return { ...result, status: 'Disabled' as const }
  if (item.history_status === 'not_applicable')
    return { ...result, status: 'Not applicable' as const }
  if (item.history_status !== 'known') return result
  result.nextMileage =
    item.interval_km !== null && item.last_completed_mileage !== null
      ? item.interval_km + item.last_completed_mileage
      : null
  result.nextDate =
    item.interval_months !== null && item.last_completed_date !== null
      ? addCalendarMonths(item.last_completed_date, item.interval_months)
      : null
  result.partialHistory =
    (item.interval_km !== null && result.nextMileage === null) ||
    (item.interval_months !== null && result.nextDate === null)
  const currentDate = parseDate(today)
  const dueDate = result.nextDate ? parseDate(result.nextDate) : null
  const daysRemaining =
    currentDate && dueDate
      ? (dueDate.getTime() - currentDate.getTime()) / 86400000
      : null
  const kmRemaining =
    result.nextMileage !== null ? result.nextMileage - mileage : null
  // Evaluate independent limits; no conversion between distance and time is possible here.
  if (
    (kmRemaining !== null && kmRemaining <= 0) ||
    (daysRemaining !== null && daysRemaining <= 0)
  )
    result.status = 'Due / overdue'
  else if (
    (kmRemaining !== null && kmRemaining <= 1000) ||
    (daysRemaining !== null && daysRemaining <= 30)
  )
    result.status = 'Due soon'
  else if (
    !result.partialHistory &&
    (kmRemaining !== null || daysRemaining !== null)
  )
    result.status = 'Up to date'
  return result
}
export function validateMaintenance(
  item: MaintenanceInput,
  currentMileage: number,
  today = dateOnly(),
): string[] {
  const errors: string[] = []
  if (!item.name.trim() || item.name.trim().length > 120)
    errors.push('Enter an operation name of 1–120 characters.')
  if (item.interval_km === null && item.interval_months === null)
    errors.push('Provide at least one interval.')
  if (
    item.interval_km !== null &&
    (!Number.isInteger(item.interval_km) ||
      item.interval_km < 1 ||
      item.interval_km > 10000000)
  )
    errors.push(
      'Kilometre interval must be a whole number from 1 to 10,000,000.',
    )
  if (
    item.interval_months !== null &&
    (!Number.isInteger(item.interval_months) ||
      item.interval_months < 1 ||
      item.interval_months > 1200)
  )
    errors.push('Month interval must be a whole number from 1 to 1,200.')
  if (!['known', 'unknown', 'not_applicable'].includes(item.history_status))
    errors.push('Choose a history status.')
  if (
    item.history_status === 'known' &&
    item.last_completed_date === null &&
    item.last_completed_mileage === null
  )
    errors.push('Known history needs a completion date and/or mileage.')
  if (
    item.history_status !== 'known' &&
    (item.last_completed_date !== null || item.last_completed_mileage !== null)
  )
    errors.push(
      'Clear completion details for unknown or not applicable history.',
    )
  if (
    item.last_completed_date !== null &&
    (!parseDate(item.last_completed_date) || item.last_completed_date > today)
  )
    errors.push('Completion date must be a valid date on or before today.')
  if (
    item.last_completed_mileage !== null &&
    (!Number.isInteger(item.last_completed_mileage) ||
      item.last_completed_mileage < 0 ||
      item.last_completed_mileage > currentMileage)
  )
    errors.push(
      'Completion mileage must be between zero and current vehicle mileage.',
    )
  return errors
}
export const starterSchedule: MaintenanceInput[] = [
  ['Engine oil + filter', 20000, 12],
  ['Timing belt', 120000, 72],
  ['Air filter', 30000, 24],
  ['Brake fluid', null, 24],
  ['Coolant', 60000, 48],
].map(([name, km, months]) => ({
  name: String(name),
  interval_km: km as number | null,
  interval_months: months as number,
  enabled: true,
  history_status: 'unknown',
  last_completed_date: null,
  last_completed_mileage: null,
}))
