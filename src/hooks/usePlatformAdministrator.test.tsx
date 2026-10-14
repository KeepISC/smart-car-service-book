import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { usePlatformAdministrator } from './usePlatformAdministrator'

const mocks = vi.hoisted(() => ({ isAdmin: vi.fn() }))
vi.mock('../services/platformAdministration', () => ({
  isPlatformAdministrator: mocks.isAdmin,
}))
vi.mock('../services/auth', () => ({ authService: { available: true } }))

beforeEach(() => vi.clearAllMocks())

it('reports the server capability only for signed-in users', async () => {
  mocks.isAdmin.mockResolvedValue(true)
  const signedOut = renderHook(() => usePlatformAdministrator(false))
  expect(signedOut.result.current).toBe(false)
  expect(mocks.isAdmin).not.toHaveBeenCalled()
  const signedIn = renderHook(() => usePlatformAdministrator(true))
  await waitFor(() => expect(signedIn.result.current).toBe(true))
})

it('fails closed when the capability check fails', async () => {
  mocks.isAdmin.mockRejectedValue(new Error('network'))
  const { result } = renderHook(() => usePlatformAdministrator(true))
  await waitFor(() => expect(mocks.isAdmin).toHaveBeenCalled())
  expect(result.current).toBe(false)
})
