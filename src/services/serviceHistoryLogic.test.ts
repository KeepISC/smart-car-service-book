import { expect, it } from 'vitest'
import { validateServiceVisit } from './serviceHistoryLogic'
import type { ServiceVisitInput } from '../types/serviceHistory'

const visit: ServiceVisitInput = {
  service_date: '2026-10-01',
  mileage: 10000,
  service_type: 'workshop',
  workshop_name: 'Fictional Workshop',
  total_cost: 125.5,
  notes: 'Fictional test record',
  operations: [
    {
      maintenance_item_id: 'fictional-schedule',
      operation_name: 'Fictional oil service',
      cost: null,
      next_interval_km: 15000,
      next_interval_months: null,
    },
    {
      maintenance_item_id: null,
      operation_name: 'Fictional custom inspection',
      cost: 12,
      next_interval_km: null,
      next_interval_months: null,
    },
  ],
}

it('accepts workshop visits with multiple scheduled and custom operations and partial costs', () => {
  expect(validateServiceVisit(visit, 20000, '2026-10-12')).toEqual([])
})

it('accepts DIY entries without a workshop and optional expense fields', () => {
  expect(
    validateServiceVisit(
      {
        ...visit,
        service_type: 'diy',
        workshop_name: null,
        total_cost: null,
        operations: [{ ...visit.operations[1], cost: null }],
      },
      20000,
      '2026-10-12',
    ),
  ).toEqual([])
})

it('rejects dates outside the database-supported finite AD range', () => {
  for (const service_date of ['0000-01-01', '-infinity']) {
    expect(
      validateServiceVisit({ ...visit, service_date }, 20000, '2026-10-12'),
    ).toContain('Enter a valid service date on or before today.')
  }
})

it('rejects future/invalid dates, future mileage, and invalid costs', () => {
  expect(
    validateServiceVisit(
      {
        ...visit,
        service_date: '2026-02-30',
        mileage: 20001,
        total_cost: -1,
        operations: [{ ...visit.operations[1], next_interval_km: 0 }],
      },
      20000,
      '2026-10-12',
    ),
  ).toEqual(
    expect.arrayContaining([
      'Enter a valid service date on or before today.',
      'Odometer must be between zero and current vehicle mileage.',
      'Total cost must be a nonnegative amount with at most two decimals.',
      'Operation 1 kilometre override must be 1–10,000,000.',
    ]),
  )
})
