import { afterEach, expect, it, vi } from 'vitest'
const setup = vi.hoisted(() => ({
  initializeApp: vi.fn(),
  getAuth: vi.fn(),
  setPersistence: vi.fn(),
  auth: {},
}))
vi.mock('firebase/app', () => ({ initializeApp: setup.initializeApp }))
vi.mock('firebase/auth', () => ({
  getAuth: setup.getAuth,
  setPersistence: setup.setPersistence,
  browserLocalPersistence: 'local',
}))
afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
  vi.clearAllMocks()
})
it('configures SDK-managed local persistence for the explicitly selected project', async () => {
  vi.stubEnv('VITE_FIREBASE_API_KEY', 'fictional-public-api-config')
  vi.stubEnv('VITE_FIREBASE_AUTH_DOMAIN', 'fictional-project.firebaseapp.com')
  vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'fictional-project')
  vi.stubEnv('VITE_FIREBASE_APP_ID', 'fictional-public-app-id')
  setup.getAuth.mockReturnValue(setup.auth)
  setup.setPersistence.mockResolvedValue(undefined)
  const config = await import('./firebase')
  await config.firebaseReady
  expect(config.firebaseConfigured).toBe(true)
  expect(setup.initializeApp).toHaveBeenCalledWith({
    apiKey: 'fictional-public-api-config',
    authDomain: 'fictional-project.firebaseapp.com',
    projectId: 'fictional-project',
    appId: 'fictional-public-app-id',
  })
  expect(config.firebaseAuth).toBe(setup.auth)
  expect(setup.setPersistence).toHaveBeenCalledWith(setup.auth, 'local')
})
it('does not initialize with placeholder credentials', async () => {
  vi.stubEnv('VITE_FIREBASE_API_KEY', 'REPLACE_ME')
  const config = await import('./firebase')
  expect(config.firebaseConfigured).toBe(false)
  expect(config.firebaseAuth).toBeNull()
  expect(setup.initializeApp).not.toHaveBeenCalled()
})
