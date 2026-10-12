import type { User } from 'firebase/auth'

const endpoint = import.meta.env.VITE_FIREBASE_PROVISIONING_URL

export class ProvisioningClientError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProvisioningClientError'
  }
}

export async function provisionFirebaseUser(user: User): Promise<void> {
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    throw new ProvisioningClientError(
      'The application provisioning endpoint is not configured.',
    )
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/provision' ||
    !(
      url.protocol === 'https:' ||
      (url.protocol === 'http:' &&
        ['localhost', '127.0.0.1'].includes(url.hostname))
    )
  )
    throw new ProvisioningClientError(
      'The application provisioning endpoint must use HTTPS (or local loopback HTTP) and the /provision path.',
    )

  const token = await user.getIdToken()
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(20000),
    })
  } catch {
    throw new ProvisioningClientError(
      'The application provisioning service could not be reached. Check that it is running and allows this website origin.',
    )
  }
  if (!response.ok) {
    const reason =
      response.status === 401
        ? 'The provisioning service rejected the Firebase identity. Verify your email and sign in again.'
        : response.status === 403
          ? 'The provisioning service denied access. Contact support to check origin and account configuration.'
          : response.status === 404
            ? 'The application provisioning endpoint was not found. Check the /provision URL.'
            : 'The application provisioning service failed. Contact support to check its Firebase Admin and database setup.'
    throw new ProvisioningClientError(reason)
  }
  // A proxy/static page returning 200 must never be mistaken for provisioning.
  let result: unknown
  try {
    result = await response.json()
  } catch {
    throw new ProvisioningClientError(
      'The application provisioning service returned an invalid response.',
    )
  }
  if (
    typeof result !== 'object' ||
    result === null ||
    !('provisioned' in result) ||
    result.provisioned !== true
  )
    throw new ProvisioningClientError(
      'The application provisioning service did not confirm account setup.',
    )
}
