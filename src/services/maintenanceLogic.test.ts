import { describe, expect, it } from 'vitest'
import {
  applyServiceHistory,
  addCalendarMonths,
  calculateMaintenance,
  validateMaintenance,
  starterSchedule,
} from './maintenanceLogic'
import type { MaintenanceInput, MaintenanceItem } from '../types/maintenance'
import type { ServiceCompletionVisit } from './maintenanceLogic'
const known: MaintenanceInput = {
  name: 'Fictional operation',
  interval_km: 20000,
  interval_months: 12,
  enabled: true,
  history_status: 'known',
  last_completed_date: '2025-01-31',
  last_completed_mileage: 10000,
}
const item: MaintenanceItem = {
  ...known,
  id: 'schedule-1',
  vehicle_id: 'vehicle-1',
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
}
function completion(
  id: string,
  serviceDate: string,
  mileage: number,
  nextIntervalKm: number | null = null,
  nextIntervalMonths: number | null = null,
): ServiceCompletionVisit {
  return {
    id,
    service_date: serviceDate,
    mileage,
    created_at: `${serviceDate}T12:00:00Z`,
    operations: [
      {
        id: `operation-${id}`,
        maintenance_item_id: item.id,
        next_interval_km: nextIntervalKm,
        next_interval_months: nextIntervalMonths,
        created_at: `${serviceDate}T12:00:00Z`,
      },
    ],
  }
}
describe('maintenance calculations', () => {
  it('uses the latest service completion and its one-time interval overrides', () => {
    const older = completion('older', '2025-02-20', 22000, 5000, 6)
    const latest = completion('latest', '2025-03-01', 23000, 15000, null)
    const [resolved] = applyServiceHistory([item], [latest, older])
    expect(resolved).toMatchObject({
      history_status: 'known',
      last_completed_date: '2025-03-01',
      last_completed_mileage: 23000,
      interval_km: 20000,
      interval_months: 12,
      next_interval_km: 15000,
      next_interval_months: null,
    })
    expect(calculateMaintenance(resolved, 23000, '2025-03-01')).toMatchObject({
      nextMileage: 38000,
      nextDate: '2026-03-01',
    })
  })
  it('keeps newer legacy baselines ahead of backdated service history', () => {
    const baseline = {
      ...item,
      last_completed_date: '2025-03-01',
      last_completed_mileage: 30000,
    }
    expect(
      applyServiceHistory(
        [baseline],
        [completion('backdated', '2025-02-28', 29000, 5000, 3)],
      )[0],
    ).toEqual(baseline)
  })
  it('uses mileage to break same-day completion ties without regressing a baseline', () => {
    const baseline = {
      ...item,
      last_completed_date: '2025-03-01',
      last_completed_mileage: 30000,
    }
    expect(
      applyServiceHistory(
        [baseline],
        [
          completion('same-day-older', '2025-03-01', 29000),
          completion('same-day-newer', '2025-03-01', 31000),
        ],
      )[0],
    ).toMatchObject({
      last_completed_date: '2025-03-01',
      last_completed_mileage: 31000,
    })
    expect(
      applyServiceHistory(
        [baseline],
        [completion('same-day-backdated', '2025-03-01', 29000)],
      )[0],
    ).toEqual(baseline)
  })
  it('compares service history to mileage-only baselines', () => {
    const baseline = {
      ...item,
      last_completed_date: null,
      last_completed_mileage: 35000,
    }
    expect(
      applyServiceHistory(
        [baseline],
        [completion('older', '2025-02-28', 25000)],
      )[0],
    ).toEqual(baseline)
    expect(
      applyServiceHistory(
        [baseline],
        [completion('newer', '2025-03-01', 40000)],
      )[0],
    ).toMatchObject({
      last_completed_date: '2025-03-01',
      last_completed_mileage: 40000,
    })
  })
  it('falls back to the remaining completion or unchanged baseline after deletion', () => {
    const baseline = {
      ...item,
      last_completed_date: '2025-01-01',
      last_completed_mileage: 10000,
    }
    const older = completion('older', '2025-02-01', 12000)
    const newest = completion('newest', '2025-03-01', 15000)
    expect(
      applyServiceHistory([baseline], [older, newest])[0].last_completed_date,
    ).toBe('2025-03-01')
    expect(
      applyServiceHistory([baseline], [older])[0].last_completed_date,
    ).toBe('2025-02-01')
    expect(applyServiceHistory([baseline], [])[0].last_completed_date).toBe(
      '2025-01-01',
    )
  })
  it('replaces not-applicable status only in the derived view when a completion exists', () => {
    const notApplicable = {
      ...item,
      history_status: 'not_applicable' as const,
      last_completed_date: null,
      last_completed_mileage: null,
    }
    expect(
      applyServiceHistory(
        [notApplicable],
        [completion('actual', '2025-03-01', 20000)],
      )[0].history_status,
    ).toBe('known')
    expect(applyServiceHistory([notApplicable], [])[0].history_status).toBe(
      'not_applicable',
    )
  })
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
  it('uses next-interval overrides only for the dimensions that were changed', () => {
    expect(
      calculateMaintenance(
        {
          ...known,
          next_interval_km: 10000,
          next_interval_months: 1,
        },
        15000,
        '2025-02-01',
      ),
    ).toMatchObject({
      nextMileage: 20000,
      nextDate: '2025-02-28',
      status: 'Due soon',
    })
    expect(
      calculateMaintenance(
        { ...known, next_interval_km: 12000, next_interval_months: null },
        15000,
        '2025-02-01',
      ),
    ).toMatchObject({
      nextMileage: 22000,
      nextDate: '2026-01-31',
    })
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
