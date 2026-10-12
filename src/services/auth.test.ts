import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  auth: { currentUser: null as unknown, authStateReady: vi.fn() },
  signInWithEmailAndPassword: vi.fn(),
  createUserWithEmailAndPassword: vi.fn(),
  signInWithPopup: vi.fn(),
  sendEmailVerification: vi.fn(),
  signOut: vi.fn(),
  onIdTokenChanged: vi.fn(),
  getIdTokenResult: vi.fn(),
  provisionFirebaseUser: vi.fn(),
}))
vi.mock('./provisioning', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./provisioning')>()),
  provisionFirebaseUser: mocks.provisionFirebaseUser,
}))
vi.mock('./firebase', () => ({
  firebaseAuth: mocks.auth,
  firebaseConfigured: true,
  firebaseProjectId: 'fictional-project',
  firebaseReady: Promise.resolve(),
}))
vi.mock('firebase/auth', () => ({ ...mocks, GoogleAuthProvider: class {} }))
import { authService } from './auth'
import { ProvisioningClientError } from './provisioning'
const owner = '00000000-0000-4000-8000-000000000001'
const user = {
  uid: 'fictional-firebase-user',
  email: 'driver@example.invalid',
  getIdTokenResult: mocks.getIdTokenResult,
}
const credentials = { email: user.email, password: 'fictional-test-only' }
beforeEach(() => {
  vi.resetAllMocks()
  mocks.auth.currentUser = user
  mocks.auth.authStateReady.mockResolvedValue(undefined)
  mocks.getIdTokenResult.mockResolvedValue({
    claims: {
      sub: user.uid,
      iss: 'https://securetoken.google.com/fictional-project',
      aud: 'fictional-project',
      role: 'authenticated',
      app_owner_id: owner,
      email_verified: true,
    },
    token: 'fictional-token',
  })
  mocks.signInWithEmailAndPassword.mockResolvedValue({ user })
  mocks.createUserWithEmailAndPassword.mockResolvedValue({ user })
  mocks.signInWithPopup.mockResolvedValue({ user })
  mocks.signOut.mockResolvedValue(undefined)
  mocks.sendEmailVerification.mockResolvedValue(undefined)
  mocks.provisionFirebaseUser.mockResolvedValue(undefined)
})
it('restores an application UUID session without exposing Firebase UID or token', async () => {
  expect(await authService.getSession()).toEqual({
    user: { id: owner, email: user.email },
  })
  expect(mocks.auth.authStateReady).toHaveBeenCalled()
})
it('supports signed-out session restoration', async () => {
  mocks.auth.currentUser = null
  expect(await authService.getSession()).toBeNull()
  expect(await authService.getUser()).toBeNull()
})
it('signs in with email and refreshes claims', async () => {
  await authService.signIn(credentials)
  expect(mocks.signInWithEmailAndPassword).toHaveBeenCalledWith(
    mocks.auth,
    credentials.email,
    credentials.password,
  )
  expect(mocks.getIdTokenResult).toHaveBeenCalledWith(true)
})
it('automatically provisions a verified first login before publishing refreshed ownership', async () => {
  mocks.getIdTokenResult.mockResolvedValueOnce({
    claims: { email_verified: true },
  })
  await authService.signIn(credentials)
  expect(mocks.provisionFirebaseUser).toHaveBeenCalledWith(user)
  expect(mocks.getIdTokenResult).toHaveBeenCalledWith(true)
  expect(await authService.getUser()).toEqual({ id: owner, email: user.email })
})
it('registers, sends verification and signs out pending verification', async () => {
  expect(
    await authService.register(credentials, 'https://example.invalid/login'),
  ).toEqual({ confirmationRequired: true })
  expect(mocks.sendEmailVerification).toHaveBeenCalledWith(user, {
    url: 'https://example.invalid/login',
  })
  expect(mocks.signOut).toHaveBeenCalledWith(mocks.auth)
})
it('signs out even if sending verification fails', async () => {
  mocks.sendEmailVerification.mockRejectedValue(
    new Error('Verification unavailable'),
  )
  await expect(
    authService.register(credentials, 'https://example.invalid/login'),
  ).rejects.toThrow('Verification unavailable')
  expect(mocks.signOut).toHaveBeenCalled()
})
it('supports Google login and logout', async () => {
  await authService.signInWithGoogle('https://example.invalid/login')
  expect(mocks.signInWithPopup).toHaveBeenCalledWith(
    mocks.auth,
    expect.any(Object),
  )
  await authService.signOut()
  expect(mocks.signOut).toHaveBeenCalledWith(mocks.auth)
})
it('rejects unprovisioned accounts instead of inventing owner IDs', async () => {
  mocks.getIdTokenResult.mockResolvedValue({ claims: {} })
  await expect(authService.getUser()).rejects.toThrow('Verify your email')
  await expect(authService.signIn(credentials)).rejects.toThrow(
    'Verify your email',
  )
})
it('normalizes token events and cleans up subscriptions', async () => {
  const unsubscribe = vi.fn()
  mocks.onIdTokenChanged.mockReturnValue(unsubscribe)
  const listener = vi.fn()
  const cleanup = authService.subscribe(listener)
  await mocks.onIdTokenChanged.mock.calls[0][1](user)
  await vi.waitFor(() =>
    expect(listener).toHaveBeenCalledWith({
      user: { id: owner, email: user.email },
    }),
  )
  mocks.onIdTokenChanged.mock.calls[0][1](null)
  expect(listener).toHaveBeenLastCalledWith(null)
  cleanup()
  expect(unsubscribe).toHaveBeenCalledOnce()
})
it('propagates sign-in errors', async () => {
  mocks.signInWithEmailAndPassword.mockRejectedValue(
    new Error('Sign-in unavailable'),
  )
  await expect(authService.signIn(credentials)).rejects.toThrow(
    'Sign-in unavailable',
  )
  expect(mocks.provisionFirebaseUser).not.toHaveBeenCalled()
})
it('does not provision or sign out when the Google popup fails', async () => {
  mocks.signInWithPopup.mockRejectedValue(
    Object.assign(new Error('Popup blocked'), { code: 'auth/popup-blocked' }),
  )
  await expect(
    authService.signInWithGoogle('https://example.invalid/login'),
  ).rejects.toMatchObject({ code: 'auth/popup-blocked' })
  expect(mocks.provisionFirebaseUser).not.toHaveBeenCalled()
  expect(mocks.signOut).not.toHaveBeenCalled()
})
it('distinguishes successful Google authentication from failed provisioning and clears its session', async () => {
  mocks.provisionFirebaseUser.mockRejectedValueOnce(
    new Error('Private backend diagnostic'),
  )
  await expect(
    authService.signInWithGoogle('https://example.invalid/login'),
  ).rejects.toThrow(
    'Firebase sign-in succeeded, but application provisioning failed',
  )
  expect(mocks.signOut).toHaveBeenCalledWith(mocks.auth)
})
it('preserves a safe provisioning configuration diagnosis after successful Firebase login', async () => {
  mocks.provisionFirebaseUser.mockRejectedValueOnce(
    new ProvisioningClientError(
      'The application provisioning endpoint is not configured.',
    ),
  )
  await expect(authService.signIn(credentials)).rejects.toThrow(
    'Firebase sign-in succeeded, but application provisioning failed. The application provisioning endpoint is not configured.',
  )
  expect(mocks.signOut).toHaveBeenCalledWith(mocks.auth)
})
it('signs out when Firebase succeeds but provisioning fails, and permits a retry', async () => {
  mocks.provisionFirebaseUser.mockRejectedValueOnce(new Error('Unavailable'))
  await expect(authService.signIn(credentials)).rejects.toThrow('provisioning')
  expect(mocks.signOut).toHaveBeenCalledWith(mocks.auth)
  await authService.signIn(credentials)
  expect(mocks.getIdTokenResult).toHaveBeenCalledWith(true)
})
it('rejects incorrect refreshed claims and clears the Firebase session', async () => {
  mocks.getIdTokenResult.mockResolvedValue({
    claims: { email_verified: true, role: 'service_role' },
  })
  await expect(authService.signIn(credentials)).rejects.toThrow('provisioning')
  expect(mocks.signOut).toHaveBeenCalled()
})
it('does not provision an unverified account', async () => {
  mocks.getIdTokenResult.mockResolvedValue({
    claims: { email_verified: false },
  })
  await expect(authService.signIn(credentials)).rejects.toThrow(
    'Verify your email',
  )
  expect(mocks.provisionFirebaseUser).not.toHaveBeenCalled()
  expect(mocks.signOut).toHaveBeenCalled()
})
it('exposes explicit logout recovery when automatic logout fails', async () => {
  mocks.provisionFirebaseUser.mockRejectedValue(new Error('Unavailable'))
  mocks.signOut.mockRejectedValueOnce(new Error('Logout unavailable'))
  await expect(authService.signIn(credentials)).rejects.toThrow('Use Sign out')
  await authService.signOut()
  expect(mocks.signOut).toHaveBeenCalledTimes(2)
})
it('never signs out a replacement account after a stale provisioning failure', async () => {
  mocks.provisionFirebaseUser.mockImplementationOnce(async () => {
    mocks.auth.currentUser = { uid: 'replacement-account' }
    throw new Error('Unavailable')
  })
  await expect(authService.signIn(credentials)).rejects.toThrow('provisioning')
  expect(mocks.signOut).not.toHaveBeenCalled()
})
