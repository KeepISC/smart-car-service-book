import type {
  MaintenanceAlertItem,
  MaintenanceAlertSummary,
  MaintenanceInput,
  MaintenanceItem,
} from '../types/maintenance'
export type MaintenanceStatus =
  | 'Up to date'
  | 'Due soon'
  | 'Due / overdue'
  | 'Unknown'
  | 'Disabled'
  | 'Not applicable'
export type ServiceCompletionVisit = {
  id: string
  service_date: string
  mileage: number
  created_at: string
  operations: {
    id: string
    maintenance_item_id: string | null
    next_interval_km: number | null
    next_interval_months: number | null
    created_at: string
  }[]
}

export function applyServiceHistory(
  items: MaintenanceItem[],
  visits: ServiceCompletionVisit[],
): MaintenanceItem[] {
  return items.map((item) => {
    const latest = visits
      .flatMap((visit) =>
        visit.operations
          .filter((operation) => operation.maintenance_item_id === item.id)
          .map((operation) => ({ visit, operation })),
      )
      .sort(
        (left, right) =>
          right.visit.service_date.localeCompare(left.visit.service_date) ||
          right.visit.mileage - left.visit.mileage ||
          right.visit.created_at.localeCompare(left.visit.created_at) ||
          right.operation.created_at.localeCompare(left.operation.created_at) ||
          right.operation.id.localeCompare(left.operation.id),
      )[0]
    if (!latest) return item

    const supersedesBaseline =
      item.last_completed_date !== null
        ? latest.visit.service_date > item.last_completed_date ||
          (latest.visit.service_date === item.last_completed_date &&
            (item.last_completed_mileage === null ||
              latest.visit.mileage >= item.last_completed_mileage))
        : item.last_completed_mileage === null ||
          latest.visit.mileage >= item.last_completed_mileage
    if (!supersedesBaseline) return item

    return {
      ...item,
      history_status: 'known',
      last_completed_date: latest.visit.service_date,
      last_completed_mileage: latest.visit.mileage,
      next_interval_km: latest.operation.next_interval_km,
      next_interval_months: latest.operation.next_interval_months,
    }
  })
}
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
export function isValidDateOnly(value: string): boolean {
  return parseDate(value) !== null
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
  item: MaintenanceInput & {
    next_interval_km?: number | null
    next_interval_months?: number | null
  },
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
    (item.next_interval_km ?? item.interval_km) !== null &&
    item.last_completed_mileage !== null
      ? (item.next_interval_km ?? item.interval_km)! +
        item.last_completed_mileage
      : null
  result.nextDate =
    (item.next_interval_months ?? item.interval_months) !== null &&
    item.last_completed_date !== null
      ? addCalendarMonths(
          item.last_completed_date,
          (item.next_interval_months ?? item.interval_months)!,
        )
      : null
  result.partialHistory =
    ((item.next_interval_km ?? item.interval_km) !== null &&
      result.nextMileage === null) ||
    ((item.next_interval_months ?? item.interval_months) !== null &&
      result.nextDate === null)
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
export function aggregateMaintenanceAlerts(
  vehiclesWithItems: {
    vehicle: { mileage: number }
    items: (MaintenanceInput & {
      next_interval_km?: number | null
      next_interval_months?: number | null
    })[]
  }[],
  today = dateOnly(),
): MaintenanceAlertSummary {
  let overdue = 0
  let dueSoon = 0
  for (const { vehicle, items } of vehiclesWithItems) {
    for (const item of items) {
      const { status } = calculateMaintenance(item, vehicle.mileage, today)
      if (status === 'Due / overdue') {
        overdue += 1
      } else if (status === 'Due soon') {
        dueSoon += 1
      }
    }
  }
  return { overdue, dueSoon }
}
export function getMaintenanceAlertDetails(
  vehiclesWithItems: {
    vehicle: {
      id?: string
      make?: string
      model?: string
      year?: number
      mileage: number
    }
    items: (MaintenanceInput & {
      id?: string
      next_interval_km?: number | null
      next_interval_months?: number | null
    })[]
  }[],
  today = dateOnly(),
): MaintenanceAlertItem[] {
  const overdueItems: MaintenanceAlertItem[] = []
  const dueSoonItems: MaintenanceAlertItem[] = []
  const currentDate = parseDate(today)

  for (const { vehicle, items } of vehiclesWithItems) {
    const nameParts = [vehicle.year, vehicle.make, vehicle.model]
      .filter((part) => part !== undefined && part !== null && part !== '')
      .join(' ')
    const vehicleName = nameParts || 'Vehicle'

    for (const item of items) {
      const result = calculateMaintenance(item, vehicle.mileage, today)
      if (result.status === 'Due / overdue' || result.status === 'Due soon') {
        const dueDate = result.nextDate ? parseDate(result.nextDate) : null
        const daysRemaining =
          currentDate && dueDate
            ? Math.round((dueDate.getTime() - currentDate.getTime()) / 86400000)
            : null
        const kmRemaining =
          result.nextMileage !== null
            ? result.nextMileage - vehicle.mileage
            : null

        const alertItem: MaintenanceAlertItem = {
          id: item.id ?? item.name,
          vehicleId: vehicle.id ?? '',
          vehicleName,
          operationName: item.name,
          status: result.status,
          dueDate: result.nextDate,
          dueMileage: result.nextMileage,
          kmRemaining,
          daysRemaining,
        }

        if (result.status === 'Due / overdue') {
          overdueItems.push(alertItem)
        } else {
          dueSoonItems.push(alertItem)
        }
      }
    }
  }

  const sortAlerts = (list: MaintenanceAlertItem[]) => {
    list.sort((a, b) => {
      if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) {
        return a.dueDate.localeCompare(b.dueDate)
      }
      if (
        a.kmRemaining !== null &&
        b.kmRemaining !== null &&
        a.kmRemaining !== b.kmRemaining
      ) {
        return a.kmRemaining - b.kmRemaining
      }
      if (a.vehicleName !== b.vehicleName) {
        return a.vehicleName.localeCompare(b.vehicleName)
      }
      return a.operationName.localeCompare(b.operationName)
    })
  }

  sortAlerts(overdueItems)
  sortAlerts(dueSoonItems)

  return [...overdueItems, ...dueSoonItems]
}
