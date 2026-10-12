const ownerPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export class ProvisioningError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

function rejectIdentity() {
  throw new ProvisioningError(401, 'Sign in again with a verified account.')
}

export async function provisionIdentity(token, { auth, database, projectId }) {
  let identity
  try {
    // Signature, expiration, revocation and disabled-account checks belong to Admin SDK.
    identity = await auth.verifyIdToken(token, true)
  } catch {
    rejectIdentity()
  }
  if (
    identity.aud !== projectId ||
    identity.iss !== `https://securetoken.google.com/${projectId}` ||
    !identity.uid ||
    identity.sub !== identity.uid ||
    identity.email_verified !== true ||
    !Number.isFinite(identity.exp) ||
    identity.exp <= Date.now() / 1000
  )
    rejectIdentity()

  const user = await auth.getUser(identity.uid)
  if (user.disabled || !user.emailVerified || user.uid !== identity.uid)
    rejectIdentity()
  const claims = user.customClaims ?? {}
  if (claims.role !== undefined && claims.role !== 'authenticated')
    throw new ProvisioningError(
      403,
      'Account configuration requires administrator review.',
    )

  // No owner ID or email is accepted for ownership. PostgreSQL provisions new
  // UIDs automatically, preserves legacy mappings and commits before claims.
  let result
  try {
    result = await database.query(
      'select app_private.provision_firebase_owner($1, $2) as owner_id',
      [identity.uid, projectId],
    )
  } catch (error) {
    if (['42501', '23505'].includes(error.code))
      throw new ProvisioningError(
        403,
        'Account access is unavailable. Contact support.',
      )
    throw error
  }
  const ownerId = result.rows[0]?.owner_id
  if (typeof ownerId !== 'string' || !ownerPattern.test(ownerId)) {
    throw new ProvisioningError(
      403,
      'Account access is unavailable. Contact support.',
    )
  }

  // A conflicting live claim requires explicit administrative repair. Never
  // transfer ownership or silently downgrade a privileged database role.
  if (claims.app_owner_id !== undefined && claims.app_owner_id !== ownerId)
    throw new ProvisioningError(
      403,
      'Account configuration requires administrator review.',
    )

  if (claims.role !== 'authenticated' || claims.app_owner_id !== ownerId) {
    await auth.setCustomUserClaims(identity.uid, {
      ...claims,
      role: 'authenticated',
      app_owner_id: ownerId,
    })
  }
  // Claim assignment may fail after the mapping commits. Retrying resolves the
  // same UUID, rather than allocating a second owner or rolling back user data.
  return { provisioned: true }
}
