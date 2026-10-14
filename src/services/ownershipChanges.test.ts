import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({
  invalidate: vi.fn(),
  maintenance: vi.fn(),
  post: vi.fn(),
  close: vi.fn(),
}))
vi.mock('./vehicles', () => ({ invalidateVehicleReads: mock.invalidate }))
vi.mock('./maintenanceChanges', () => ({
  notifyMaintenanceChange: mock.maintenance,
}))
import { announceOwnershipChange } from './ownershipChanges'
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal(
    'BroadcastChannel',
    class {
      postMessage = mock.post
      close = mock.close
    },
  )
})
afterEach(() => vi.unstubAllGlobals())
it('invalidates vehicle reads and broadcasts only a same-origin change signal', () => {
  const vehicle = vi.fn()
  const ownership = vi.fn()
  window.addEventListener('app:vehicle-change', vehicle)
  window.addEventListener('app:ownership-change', ownership)
  announceOwnershipChange()
  expect(mock.invalidate).toHaveBeenCalledOnce()
  expect(mock.maintenance).toHaveBeenCalledOnce()
  expect(mock.post).toHaveBeenCalledExactlyOnceWith('changed')
  expect(mock.close).toHaveBeenCalledOnce()
  expect(vehicle).toHaveBeenCalledOnce()
  expect(ownership).toHaveBeenCalledOnce()
  window.removeEventListener('app:vehicle-change', vehicle)
  window.removeEventListener('app:ownership-change', ownership)
})
it('preserves committed success if the browser blocks BroadcastChannel', () => {
  vi.stubGlobal(
    'BroadcastChannel',
    class {
      constructor() {
        throw new Error('Blocked')
      }
    },
  )
  expect(announceOwnershipChange).not.toThrow()
  expect(mock.invalidate).toHaveBeenCalledOnce()
})
