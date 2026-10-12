const ownerPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function firebaseOwnerId(
  claims: Record<string, unknown>,
  uid: string,
  projectId: string,
): string | null {
  // This is a frontend readiness check. Supabase validates the signature; RLS checks the mapping.
  if (
    !projectId ||
    claims.iss !== `https://securetoken.google.com/${projectId}` ||
    claims.aud !== projectId ||
    claims.sub !== uid ||
    claims.role !== 'authenticated' ||
    claims.email_verified !== true
  )
    return null
  return typeof claims.app_owner_id === 'string' &&
    ownerPattern.test(claims.app_owner_id)
    ? claims.app_owner_id
    : null
}
