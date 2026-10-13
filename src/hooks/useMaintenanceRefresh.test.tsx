import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useMaintenanceRefresh } from './useMaintenanceRefresh'

afterEach(() => vi.useRealTimers())

it('coalesces focus and visibility refreshes and cleans up on unmount', () => {
  vi.useFakeTimers()
  const { result, unmount } = renderHook(() => useMaintenanceRefresh())
  act(() => {
    window.dispatchEvent(new Event('focus'))
    document.dispatchEvent(new Event('visibilitychange'))
    vi.runOnlyPendingTimers()
  })
  expect(result.current.revision).toBe(1)
  act(() => window.dispatchEvent(new Event('app:maintenance-change')))
  unmount()
  expect(vi.getTimerCount()).toBe(0)
})
