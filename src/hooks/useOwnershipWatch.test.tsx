import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useOwnershipWatch } from './useOwnershipWatch'
const api = vi.hoisted(() => ({
  snapshot: vi.fn(),
  refresh: vi.fn(),
  clearSender: vi.fn(),
}))
vi.mock('../services/vehicles', () => ({
  loadVehicleOwnershipSnapshot: api.snapshot,
}))
vi.mock('../services/ownershipChanges', () => ({
  ownershipChannel: 'scsb:ownership-change',
  refreshOwnershipViews: api.refresh,
}))
vi.mock('../services/transferSession', () => ({
  saveSenderTransfer: api.clearSender,
}))
beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  api.snapshot.mockResolvedValue([{ id: 'v', ownership_epoch: 0 }])
})
afterEach(() => vi.useRealTimers())
it('detects lost access and epoch changes while the screen remains open', async () => {
  const { unmount } = renderHook(() => useOwnershipWatch(true))
  await act(async () => {})
  api.snapshot.mockResolvedValueOnce([])
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000)
  })
  expect(api.refresh).toHaveBeenCalledTimes(1)
  expect(api.clearSender).toHaveBeenCalledWith('v', null)
  api.snapshot.mockResolvedValueOnce([{ id: 'v', ownership_epoch: 2 }])
  await act(async () => {
    window.dispatchEvent(new Event('focus'))
  })
  expect(api.refresh).toHaveBeenCalledTimes(2)
  unmount()
  expect(vi.getTimerCount()).toBe(0)
})
it('ignores stale responses, retries failures and stops on unmount', async () => {
  let complete!: (value: { id: string; ownership_epoch: number }[]) => void
  api.snapshot.mockReturnValueOnce(
    new Promise((resolve) => {
      complete = resolve
    }),
  )
  const { unmount } = renderHook(() => useOwnershipWatch(true))
  await act(async () => {
    window.dispatchEvent(new Event('focus'))
  })
  await act(async () => {
    complete([])
  })
  expect(api.refresh).not.toHaveBeenCalled()
  api.snapshot.mockRejectedValueOnce(new Error('Offline'))
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000)
  })
  api.snapshot.mockResolvedValueOnce([])
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000)
  })
  expect(api.refresh).toHaveBeenCalledTimes(1)
  unmount()
})
it('does not query when signed out', () => {
  renderHook(() => useOwnershipWatch(false))
  expect(api.snapshot).not.toHaveBeenCalled()
})
