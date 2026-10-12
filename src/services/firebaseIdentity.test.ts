import { expect, it } from 'vitest'
import { firebaseOwnerId } from './firebaseIdentity'
const owner = '00000000-0000-4000-8000-000000000001'
const claims = {
  iss: 'https://securetoken.google.com/fictional-project',
  aud: 'fictional-project',
  sub: 'firebase-example',
  role: 'authenticated',
  app_owner_id: owner,
  email_verified: true,
}
it('uses the canonical UUID rather than the Firebase UID', () =>
  expect(firebaseOwnerId(claims, 'firebase-example', 'fictional-project')).toBe(
    owner,
  ))
it.each([
  { iss: 'https://securetoken.google.com/other-project' },
  { aud: 'other-project' },
  { sub: 'other-user' },
  { role: 'anon' },
  { app_owner_id: 'not-a-uuid' },
  { email_verified: false },
  { app_owner_id: undefined },
])('rejects an invalid or foreign identity %j', (change) =>
  expect(
    firebaseOwnerId(
      { ...claims, ...change },
      'firebase-example',
      'fictional-project',
    ),
  ).toBeNull(),
)
