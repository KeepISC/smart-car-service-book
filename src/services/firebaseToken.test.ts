import { beforeEach, expect, it, vi } from 'vitest'
const api = vi.hoisted(() => ({
  auth: { currentUser: null as unknown, authStateReady: vi.fn() },
  getIdTokenResult: vi.fn(),
}))
vi.mock('./firebase', () => ({
  firebaseAuth: api.auth,
  firebaseProjectId: 'fictional-project',
  firebaseReady: Promise.resolve(),
}))
import { firebaseDatabaseToken } from './firebaseToken'
beforeEach(() => {
  vi.resetAllMocks()
  api.auth.authStateReady.mockResolvedValue(undefined)
  api.auth.currentUser = {
    uid: 'firebase-example',
    getIdTokenResult: api.getIdTokenResult,
  }
  api.getIdTokenResult.mockResolvedValue({
    token: 'fictional-token',
    claims: {
      sub: 'firebase-example',
      iss: 'https://securetoken.google.com/fictional-project',
      aud: 'fictional-project',
      role: 'authenticated',
      email_verified: true,
      app_owner_id: '00000000-0000-4000-8000-000000000001',
    },
  })
})
it('waits for persisted identity restoration and supplies the Firebase token', async () => {
  expect(await firebaseDatabaseToken()).toBe('fictional-token')
  expect(api.auth.authStateReady).toHaveBeenCalledOnce()
})
it('returns null for signed-out requests', async () => {
  api.auth.currentUser = null
  expect(await firebaseDatabaseToken()).toBeNull()
})
it('blocks missing claims without falling back to a Supabase session', async () => {
  api.getIdTokenResult.mockResolvedValue({
    claims: {},
    token: 'fictional-token',
  })
  await expect(firebaseDatabaseToken()).rejects.toThrow(
    'complete account setup',
  )
})
it('propagates token refresh errors instead of silently sending an anonymous request', async () => {
  api.getIdTokenResult.mockRejectedValue(new Error('Refresh failed'))
  await expect(firebaseDatabaseToken()).rejects.toThrow('Refresh failed')
})
