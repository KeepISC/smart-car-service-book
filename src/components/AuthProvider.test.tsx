import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import type { AuthSession } from '../types/auth'
const api = vi.hoisted(() => ({
  getSession: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
}))
vi.mock('../services/auth', () => ({
  authService: {
    available: true,
    getSession: api.getSession,
    subscribe: api.subscribe,
  },
}))
import { AuthProvider, useAuth } from './AuthProvider'
function Account() {
  const { session, loading, error } = useAuth()
  return (
    <div>{loading ? 'Loading' : error || session?.user.id || 'Signed out'}</div>
  )
}
beforeEach(() => {
  vi.resetAllMocks()
  sessionStorage.clear()
  api.getSession.mockResolvedValue(null)
  api.subscribe.mockReturnValue(api.unsubscribe)
})

it('preserves transfer recovery on restoration but clears it when the account changes', async () => {
  sessionStorage.setItem('scsb:transfer:recipient', 'a'.repeat(64))
  api.getSession.mockResolvedValue({ user: { id: 'fictional-a' } })
  render(
    <AuthProvider>
      <Account />
    </AuthProvider>,
  )
  await screen.findByText('fictional-a')
  expect(sessionStorage.length).toBe(1)
  await act(async () =>
    api.subscribe.mock.calls[0][0]({ user: { id: 'fictional-b' } }),
  )
  expect(sessionStorage.length).toBe(0)
  sessionStorage.setItem('scsb:transfer:recipient', 'b'.repeat(64))
  await act(async () => api.subscribe.mock.calls[0][0](null))
  expect(sessionStorage.length).toBe(0)
})
it('restores a persistent session and unsubscribes on unmount', async () => {
  api.getSession.mockResolvedValue({ user: { id: 'fictional-user' } })
  const view = render(
    <AuthProvider>
      <Account />
    </AuthProvider>,
  )
  expect(await screen.findByText('fictional-user')).toBeInTheDocument()
  view.unmount()
  expect(api.unsubscribe).toHaveBeenCalledOnce()
})
it('keeps a newer sign-out event when an older session lookup resolves', async () => {
  let resolve!: (session: AuthSession | null) => void
  api.getSession.mockReturnValue(
    new Promise<AuthSession | null>((done) => {
      resolve = done
    }),
  )
  render(
    <AuthProvider>
      <Account />
    </AuthProvider>,
  )
  await act(async () => {
    api.subscribe.mock.calls[0][0](null)
    resolve({ user: { id: 'stale-fictional-user' } })
  })
  expect(screen.getByText('Signed out')).toBeInTheDocument()
})
it('recovers from a restoration error when a fresh auth event arrives', async () => {
  api.getSession.mockRejectedValue(new Error('Provider unavailable'))
  render(
    <AuthProvider>
      <Account />
    </AuthProvider>,
  )
  await waitFor(() =>
    expect(
      screen.getByText('Unable to restore your session.'),
    ).toBeInTheDocument(),
  )
  await act(async () =>
    api.subscribe.mock.calls[0][0]({ user: { id: 'fictional-user' } }),
  )
  expect(screen.getByText('fictional-user')).toBeInTheDocument()
})
