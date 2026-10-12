export class MileageConsistencyError extends Error {
  constructor() {
    super(
      'Current vehicle mileage must be at least the highest recorded maintenance completion mileage. Check the odometer and completion values.',
    )
    this.name = 'MileageConsistencyError'
  }
}

export function isMileageConsistencyViolation(error: {
  code?: string
  message?: string
}): boolean {
  // Only our fixed database validation messages become field errors, never raw diagnostics.
  return (
    error.code === '23514' &&
    [
      'Vehicle mileage is below a recorded maintenance completion',
      'Maintenance completion exceeds current vehicle mileage',
    ].includes(error.message ?? '')
  )
}
