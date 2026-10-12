import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useLocalDate } from './useLocalDate'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})
it('updates at local midnight and removes its timer/listeners on unmount', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 9, 12, 23, 59, 59))
  const removeWindow = vi.spyOn(window, 'removeEventListener')
  const removeDocument = vi.spyOn(document, 'removeEventListener')
  const view = renderHook(useLocalDate)
  expect(view.result.current).toBe('2026-10-12')
  act(() => vi.advanceTimersByTime(1000))
  expect(view.result.current).toBe('2026-10-13')
  expect(vi.getTimerCount()).toBe(1)
  view.unmount()
  expect(vi.getTimerCount()).toBe(0)
  expect(removeWindow).toHaveBeenCalledWith('focus', expect.any(Function))
  expect(removeWindow).toHaveBeenCalledWith('pageshow', expect.any(Function))
  expect(removeDocument).toHaveBeenCalledWith(
    'visibilitychange',
    expect.any(Function),
  )
  vi.restoreAllMocks()
})
it('catches up after sleep or a timezone/date change when the tab resumes', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 9, 12, 12))
  const view = renderHook(useLocalDate)
  vi.setSystemTime(new Date(2026, 9, 14, 8))
  act(() => window.dispatchEvent(new Event('focus')))
  expect(view.result.current).toBe('2026-10-14')
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  vi.setSystemTime(new Date(2026, 9, 15, 9))
  act(() => document.dispatchEvent(new Event('visibilitychange')))
  expect(view.result.current).toBe('2026-10-15')
  expect(vi.getTimerCount()).toBe(1)
  view.unmount()
})
it('schedules a calendar midnight rather than adding a fixed 24 hours', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 2, 29, 0))
  const schedule = vi.spyOn(globalThis, 'setTimeout')
  const view = renderHook(useLocalDate)
  const expectedDelay = new Date(2026, 2, 30).getTime() - Date.now()
  expect(schedule).toHaveBeenLastCalledWith(expect.any(Function), expectedDelay)
  act(() => vi.advanceTimersByTime(expectedDelay))
  expect(view.result.current).toBe('2026-03-30')
  view.unmount()
  schedule.mockRestore()
})
it.each([
  [2, 29, 23],
  [9, 25, 25],
])(
  'handles the Lisbon DST day (%s/%s) without a fixed-day interval',
  (month, day, hours) => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, month, day))
    const schedule = vi.spyOn(globalThis, 'setTimeout')
    const view = renderHook(useLocalDate)
    expect(schedule).toHaveBeenLastCalledWith(
      expect.any(Function),
      hours * 60 * 60 * 1000,
    )
    view.unmount()
  },
)
