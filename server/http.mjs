import { ProvisioningError } from './provisioning.mjs'

export function provisioningHandler({
  allowedOrigins,
  provision,
  maxRequests = 60,
  maxConcurrent = 4,
  now = Date.now,
}) {
  let windowStarted = now()
  let requests = 0
  let activeRequests = 0
  return async (request, response) => {
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    const origin = request.headers.origin
    if (!allowedOrigins.includes(origin)) {
      response.writeHead(403).end()
      return
    }
    response.setHeader('Access-Control-Allow-Origin', origin)
    response.setHeader('Vary', 'Origin')
    if (request.url !== '/provision') {
      response.writeHead(404).end()
      return
    }
    if (request.method === 'OPTIONS') {
      response.setHeader('Access-Control-Allow-Methods', 'POST')
      response.setHeader('Access-Control-Allow-Headers', 'Authorization')
      response.writeHead(204).end()
      return
    }
    if (request.method !== 'POST') {
      response.writeHead(405, { Allow: 'POST' }).end()
      return
    }
    // This endpoint has no request payload, cookies, or client-selected UID/owner.
    if (
      request.headers['transfer-encoding'] ||
      Number(request.headers['content-length'] ?? 0) !== 0
    ) {
      response.writeHead(400).end()
      return
    }
    const authorization = request.headers.authorization ?? ''
    const match = /^Bearer ([^\s]{1,16384})$/.exec(authorization)
    if (!match) {
      response.writeHead(401).end()
      return
    }
    // A process-wide cap bounds paid SDK calls and database work, including forged tokens.
    // Production proxies must also enforce per-client limits; CORS is not authentication.
    const timestamp = now()
    if (timestamp - windowStarted >= 60000) {
      windowStarted = timestamp
      requests = 0
    }
    if (requests >= maxRequests || activeRequests >= maxConcurrent) {
      response
        .writeHead(429, {
          'Retry-After': String(
            requests >= maxRequests
              ? Math.max(
                  1,
                  Math.ceil((60000 - (timestamp - windowStarted)) / 1000),
                )
              : 1,
          ),
        })
        .end()
      return
    }
    requests += 1
    activeRequests += 1
    try {
      const result = await provision(match[1])
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify(result))
    } catch (error) {
      // Never send SDK/SQL errors, tokens, connection strings or account details.
      const status = error instanceof ProvisioningError ? error.status : 503
      response.writeHead(status, { 'Content-Type': 'application/json' })
      response.end(
        JSON.stringify({
          error:
            'Account setup could not be completed. Retry or contact support.',
        }),
      )
    } finally {
      activeRequests -= 1
    }
  }
}
