import type { ServiceVisitInput } from '../types/serviceHistory'
import { isValidDateOnly } from './maintenanceLogic'

const moneyLimit = 999999999.99
const mileageLimit = 10000000
function validCost(value: number | null): boolean {
  return (
    value === null ||
    (Number.isFinite(value) &&
      value >= 0 &&
      value <= moneyLimit &&
      Number(value.toFixed(2)) === value)
  )
}
export function validateServiceVisit(
  input: ServiceVisitInput,
  currentMileage: number,
  today: string,
): string[] {
  const errors: string[] = []
  if (
    !isValidDateOnly(input.service_date) ||
    input.service_date < '0001-01-01' ||
    input.service_date > today
  )
    errors.push('Enter a valid service date on or before today.')
  if (
    !Number.isInteger(input.mileage) ||
    input.mileage < 0 ||
    input.mileage > Math.min(currentMileage, mileageLimit)
  )
    errors.push('Odometer must be between zero and current vehicle mileage.')
  if (!['diy', 'workshop'].includes(input.service_type))
    errors.push('Choose DIY or workshop service.')
  if (
    input.workshop_name !== null &&
    (!input.workshop_name.trim() || input.workshop_name.trim().length > 120)
  )
    errors.push('Workshop name must contain 1–120 characters.')
  if (input.service_type === 'diy' && input.workshop_name !== null)
    errors.push('DIY visits cannot include a workshop name.')
  if (!validCost(input.total_cost))
    errors.push(
      'Total cost must be a nonnegative amount with at most two decimals.',
    )
  if (input.notes !== null && input.notes.length > 4000)
    errors.push('Notes must be 4,000 characters or fewer.')
  if (input.operations.length < 1 || input.operations.length > 50)
    errors.push('Add between 1 and 50 service operations.')
  input.operations.forEach((operation, index) => {
    const label = operation.operation_name.trim()
    if (!label || label.length > 120)
      errors.push(`Operation ${index + 1} must contain 1–120 characters.`)
    if (!validCost(operation.cost))
      errors.push(
        `Operation ${index + 1} cost must be a nonnegative amount with at most two decimals.`,
      )
    if (
      operation.next_interval_km !== null &&
      (!Number.isInteger(operation.next_interval_km) ||
        operation.next_interval_km < 1 ||
        operation.next_interval_km > mileageLimit)
    )
      errors.push(
        `Operation ${index + 1} kilometre override must be 1–10,000,000.`,
      )
    if (
      operation.next_interval_months !== null &&
      (!Number.isInteger(operation.next_interval_months) ||
        operation.next_interval_months < 1 ||
        operation.next_interval_months > 1200)
    )
      errors.push(`Operation ${index + 1} month override must be 1–1,200.`)
  })
  return errors
}
