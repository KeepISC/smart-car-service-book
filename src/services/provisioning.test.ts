import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { User } from 'firebase/auth'
const getIdToken = vi.fn()
const user = { getIdToken } as unknown as User
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})
beforeEach(() => {
  vi.resetModules()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  getIdToken.mockReset().mockResolvedValue('fictional-token')
  vi.stubEnv(
    'VITE_FIREBASE_PROVISIONING_URL',
    'https://example.invalid/provision',
  )
})
it('uses an authorization header, no cookies, no body and no redirects', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue({ ok: true, json: async () => ({ provisioned: true }) })
  vi.stubGlobal('fetch', fetch)
  const { provisionFirebaseUser } = await import('./provisioning')
  await provisionFirebaseUser(user)
  expect(fetch).toHaveBeenCalledWith(
    new URL('https://example.invalid/provision'),
    expect.objectContaining({
      method: 'POST',
      headers: { Authorization: 'Bearer fictional-token' },
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
    }),
  )
  expect(fetch.mock.calls[0][1]).not.toHaveProperty('body')
})
it.each([
  '',
  'http://example.invalid/provision',
  'https://user:password@example.invalid/provision',
  'https://example.invalid/provision?owner=chosen',
  'https://example.invalid/wrong-path',
])(
  'rejects unsafe or missing endpoint %s before obtaining a token',
  async (endpoint) => {
    vi.stubEnv('VITE_FIREBASE_PROVISIONING_URL', endpoint)
    const { provisionFirebaseUser } = await import('./provisioning')
    await expect(provisionFirebaseUser(user)).rejects.toThrow()
    expect(getIdToken).not.toHaveBeenCalled()
  },
)
it('does not display server diagnostics after failure', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: false, text: () => 'Private diagnostic' }),
  )
  const { provisionFirebaseUser } = await import('./provisioning')
  await expect(provisionFirebaseUser(user)).rejects.toThrow(
    'application provisioning service failed',
  )
})
it('supports the loopback endpoint used alongside Vite', async () => {
  vi.stubEnv(
    'VITE_FIREBASE_PROVISIONING_URL',
    'http://127.0.0.1:8787/provision',
  )
  const fetch = vi
    .fn()
    .mockResolvedValue({ ok: true, json: async () => ({ provisioned: true }) })
  vi.stubGlobal('fetch', fetch)
  const { provisionFirebaseUser } = await import('./provisioning')
  await provisionFirebaseUser(user)
  expect(fetch).toHaveBeenCalledWith(
    new URL('http://127.0.0.1:8787/provision'),
    expect.any(Object),
  )
})
it('distinguishes an unreachable service from rejected identity', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockRejectedValue(new Error('Private network diagnostic')),
  )
  const { provisionFirebaseUser } = await import('./provisioning')
  await expect(provisionFirebaseUser(user)).rejects.toThrow(
    'could not be reached',
  )
})
it.each([
  [401, 'rejected the Firebase identity'],
  [403, 'denied access'],
  [404, 'endpoint was not found'],
  [503, 'Firebase Admin and database setup'],
])(
  'explains HTTP %s without displaying backend diagnostics',
  async (status, message) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status }))
    const { provisionFirebaseUser } = await import('./provisioning')
    await expect(provisionFirebaseUser(user)).rejects.toThrow(message)
  },
)
it.each([{}, { provisioned: false }, null])(
  'rejects HTTP success without confirmed provisioning %j',
  async (result) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => result }),
    )
    const { provisionFirebaseUser } = await import('./provisioning')
    await expect(provisionFirebaseUser(user)).rejects.toThrow('did not confirm')
  },
)
it('rejects a static page or proxy response with HTTP success', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => {
        throw new Error('Private body')
      },
    }),
  )
  const { provisionFirebaseUser } = await import('./provisioning')
  await expect(provisionFirebaseUser(user)).rejects.toThrow('invalid response')
})
