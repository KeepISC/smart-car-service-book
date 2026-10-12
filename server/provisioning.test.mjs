// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest'
import { provisionIdentity } from './provisioning.mjs'

const owner = '00000000-0000-4000-8000-000000000001'
const projectId = 'fictional-project'
const auth = {
  verifyIdToken: vi.fn(),
  getUser: vi.fn(),
  setCustomUserClaims: vi.fn(),
}
const database = { query: vi.fn() }
const context = { auth, database, projectId }
let identity
let user
beforeEach(() => {
  vi.resetAllMocks()
  identity = {
    uid: 'fictional-user',
    sub: 'fictional-user',
    aud: projectId,
    iss: `https://securetoken.google.com/${projectId}`,
    email_verified: true,
    exp: Date.now() / 1000 + 3600,
  }
  user = {
    uid: identity.uid,
    emailVerified: true,
    disabled: false,
    customClaims: { unrelated: 'preserved' },
  }
  auth.verifyIdToken.mockImplementation(async () => identity)
  auth.getUser.mockImplementation(async () => user)
  auth.setCustomUserClaims.mockResolvedValue(undefined)
  database.query.mockResolvedValue({ rows: [{ owner_id: owner }] })
})
it('provisions a first-time verified user with canonical claims and preserves unrelated claims', async () => {
  expect(await provisionIdentity('fictional-token', context)).toEqual({
    provisioned: true,
  })
  expect(auth.verifyIdToken).toHaveBeenCalledWith('fictional-token', true)
  expect(database.query).toHaveBeenCalledWith(
    'select app_private.provision_firebase_owner($1, $2) as owner_id',
    [identity.uid, projectId],
  )
  expect(auth.setCustomUserClaims).toHaveBeenCalledWith(identity.uid, {
    unrelated: 'preserved',
    role: 'authenticated',
    app_owner_id: owner,
  })
})
it('returns the mapped owner without rewriting claims for a returning user', async () => {
  user.customClaims = { role: 'authenticated', app_owner_id: owner }
  await provisionIdentity('fictional-token', context)
  expect(auth.setCustomUserClaims).not.toHaveBeenCalled()
})
it('never uses matching emails or provider names to select ownership', async () => {
  identity.email = 'legacy@example.invalid'
  identity.firebase = { sign_in_provider: 'apple.com' }
  user.email = identity.email
  await provisionIdentity('fictional-token', context)
  expect(database.query).toHaveBeenCalledWith(
    'select app_private.provision_firebase_owner($1, $2) as owner_id',
    [identity.uid, projectId],
  )
})
it('safely retries claim assignment after the database mapping has committed', async () => {
  auth.setCustomUserClaims.mockRejectedValueOnce(new Error('Admin unavailable'))
  await expect(provisionIdentity('fictional-token', context)).rejects.toThrow(
    'Admin unavailable',
  )
  await provisionIdentity('fictional-token', context)
  expect(database.query).toHaveBeenCalledTimes(2)
  for (const [, claims] of auth.setCustomUserClaims.mock.calls)
    expect(claims.app_owner_id).toBe(owner)
})
it('duplicate concurrent requests assign the same canonical owner', async () => {
  await Promise.all([
    provisionIdentity('fictional-token', context),
    provisionIdentity('fictional-token', context),
  ])
  for (const [, claims] of auth.setCustomUserClaims.mock.calls)
    expect(claims.app_owner_id).toBe(owner)
})
it.each([
  'auth/id-token-expired',
  'auth/argument-error',
  'auth/id-token-revoked',
  'auth/user-disabled',
])('rejects %s before any database write', async (code) => {
  auth.verifyIdToken.mockRejectedValue(
    Object.assign(new Error('Sensitive SDK diagnostic'), { code }),
  )
  await expect(
    provisionIdentity('fictional-token', context),
  ).rejects.toMatchObject({ status: 401 })
  expect(database.query).not.toHaveBeenCalled()
})
it.each([
  { aud: 'foreign-project' },
  { iss: 'https://securetoken.google.com/foreign-project' },
  { email_verified: false },
  { exp: 0 },
  { uid: '' },
  { sub: 'other-user' },
])('rejects invalid verified identity fields %j', async (change) => {
  Object.assign(identity, change)
  await expect(
    provisionIdentity('fictional-token', context),
  ).rejects.toMatchObject({ status: 401 })
  expect(database.query).not.toHaveBeenCalled()
})
it.each([{ disabled: true }, { emailVerified: false }, { uid: 'other-user' }])(
  'checks current account state %j',
  async (change) => {
    Object.assign(user, change)
    await expect(
      provisionIdentity('fictional-token', context),
    ).rejects.toMatchObject({ status: 401 })
    expect(database.query).not.toHaveBeenCalled()
  },
)
it('denies disabled identities or an unconfigured database project', async () => {
  database.query.mockRejectedValue(
    Object.assign(new Error('Private diagnostic'), { code: '42501' }),
  )
  await expect(
    provisionIdentity('fictional-token', context),
  ).rejects.toMatchObject({ status: 403 })
  expect(auth.setCustomUserClaims).not.toHaveBeenCalled()
})
it('rejects privileged custom roles before allocating ownership', async () => {
  user.customClaims = { role: 'service_role' }
  await expect(
    provisionIdentity('fictional-token', context),
  ).rejects.toMatchObject({ status: 403 })
  expect(database.query).not.toHaveBeenCalled()
})
it.each([
  { role: 'service_role' },
  { app_owner_id: '00000000-0000-4000-8000-000000000002' },
])('never overwrites conflicting live claims %j', async (claims) => {
  user.customClaims = claims
  await expect(
    provisionIdentity('fictional-token', context),
  ).rejects.toMatchObject({ status: 403 })
  expect(auth.setCustomUserClaims).not.toHaveBeenCalled()
})
it('repairs stale token claims only from current trusted user state and database mapping', async () => {
  identity.app_owner_id = 'frontend-cannot-select-this'
  identity.role = 'incorrect-stale-claim'
  await provisionIdentity('fictional-token', context)
  expect(auth.setCustomUserClaims).toHaveBeenCalledWith(
    identity.uid,
    expect.objectContaining({ app_owner_id: owner, role: 'authenticated' }),
  )
})
