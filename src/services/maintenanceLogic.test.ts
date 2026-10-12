import { describe, expect, it } from 'vitest'
import {
  addCalendarMonths,
  calculateMaintenance,
  validateMaintenance,
  starterSchedule,
} from './maintenanceLogic'
import type { MaintenanceInput } from '../types/maintenance'
const known: MaintenanceInput = {
  name: 'Fictional operation',
  interval_km: 20000,
  interval_months: 12,
  enabled: true,
  history_status: 'known',
  last_completed_date: '2025-01-31',
  last_completed_mileage: 10000,
}
describe('maintenance calculations', () => {
  it('adds mileage intervals to the last completion, not current mileage', () => {
    const result = calculateMaintenance(
      { ...known, interval_months: null },
      15000,
      '2025-02-01',
    )
    expect(result.nextMileage).toBe(30000)
    expect(result.nextDate).toBeNull()
    expect(result.status).toBe('Up to date')
  })
  it('adds calendar months and clamps month ends, including leap years', () => {
    expect(addCalendarMonths('2025-01-31', 1)).toBe('2025-02-28')
    expect(addCalendarMonths('2024-01-31', 1)).toBe('2024-02-29')
    expect(addCalendarMonths('2024-02-29', 12)).toBe('2025-02-28')
  })
  it('supports time-only operations without mileage estimates', () => {
    const result = calculateMaintenance(
      { ...known, interval_km: null },
      999999,
      '2026-01-01',
    )
    expect(result.status).toBe('Due soon')
    expect(result.nextMileage).toBeNull()
    expect(result.nextDate).toBe('2026-01-31')
  })
  it.each([
    ['2025-02-01', 30000],
    ['2026-01-31', 15000],
    ['2026-02-01', 30001],
  ] as const)(
    'is due when either limit is reached (%s, %s)',
    (today, mileage) =>
      expect(calculateMaintenance(known, mileage, today).status).toBe(
        'Due / overdue',
      ),
  )
  it.each([
    ['2025-02-01', 29000],
    ['2026-01-01', 15000],
  ] as const)('uses inclusive reminder thresholds (%s, %s)', (today, mileage) =>
    expect(calculateMaintenance(known, mileage, today).status).toBe('Due soon'),
  )
  it('stays current outside both reminder windows', () =>
    expect(calculateMaintenance(known, 28999, '2025-12-31').status).toBe(
      'Up to date',
    ))
  it('never infers overdue status from unknown history', () =>
    expect(
      calculateMaintenance(
        {
          ...known,
          history_status: 'unknown',
          last_completed_date: null,
          last_completed_mileage: null,
        },
        999999,
        '2030-01-01',
      ),
    ).toMatchObject({ status: 'Unknown', nextDate: null, nextMileage: null }))
  it('marks partial baselines unknown unless a known limit is approaching or due', () => {
    expect(
      calculateMaintenance(
        { ...known, last_completed_date: null },
        15000,
        '2030-01-01',
      ).status,
    ).toBe('Unknown')
    expect(
      calculateMaintenance(
        { ...known, last_completed_date: null },
        30000,
        '2030-01-01',
      ).status,
    ).toBe('Due / overdue')
  })
  it('ignores disabled and not applicable operations', () => {
    expect(
      calculateMaintenance({ ...known, enabled: false }, 999999, '2030-01-01')
        .status,
    ).toBe('Disabled')
    expect(
      calculateMaintenance(
        { ...known, history_status: 'not_applicable' },
        999999,
      ).status,
    ).toBe('Not applicable')
  })
  it('recalculates after editing intervals', () => {
    expect(calculateMaintenance(known, 25000, '2025-02-01').status).toBe(
      'Up to date',
    )
    expect(
      calculateMaintenance(
        { ...known, interval_km: 15000 },
        25000,
        '2025-02-01',
      ).status,
    ).toBe('Due / overdue')
  })
  it('does not invent dates from distance', () =>
    expect(
      calculateMaintenance({ ...known, interval_months: null }, 30000).nextDate,
    ).toBeNull())
  it('rejects missing intervals, future dates and implausible completion mileage', () => {
    expect(
      validateMaintenance(
        { ...known, interval_km: null, interval_months: null },
        20000,
        '2025-02-01',
      ),
    ).not.toEqual([])
    expect(
      validateMaintenance(
        { ...known, last_completed_date: '2025-02-30' },
        20000,
        '2025-03-01',
      ),
    ).not.toEqual([])
    expect(
      validateMaintenance(
        { ...known, last_completed_date: '2026-01-01' },
        20000,
        '2025-02-01',
      ),
    ).not.toEqual([])
    expect(validateMaintenance(known, 9999, '2025-02-01')).not.toEqual([])
  })
  it('requires a known baseline, accepts zero mileage, and rejects stale unknown baselines', () => {
    expect(
      validateMaintenance(
        { ...known, last_completed_date: null, last_completed_mileage: null },
        20000,
      ),
    ).not.toEqual([])
    expect(
      validateMaintenance(
        { ...known, last_completed_mileage: 0 },
        20000,
        '2025-02-01',
      ),
    ).toEqual([])
    expect(
      validateMaintenance({ ...known, history_status: 'unknown' }, 20000),
    ).not.toEqual([])
  })
  it('provides only unknown-history illustrative starters', () => {
    expect(starterSchedule).toHaveLength(5)
    expect(
      starterSchedule.map((item) => [item.interval_km, item.interval_months]),
    ).toEqual([
      [20000, 12],
      [120000, 72],
      [30000, 24],
      [null, 24],
      [60000, 48],
    ])
    expect(
      starterSchedule.every((item) => item.history_status === 'unknown'),
    ).toBe(true)
  })
})
