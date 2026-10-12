import { existsSync, readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'

function readEnvironment(path) {
  return existsSync(path) ? parseEnv(readFileSync(path, 'utf8')) : {}
}
function report(label, passed) {
  console.log(`${passed ? 'PASS' : 'MISSING/FAILED'}: ${label}`)
  if (!passed) process.exitCode = 1
}

// Never print values, tokens, credentials, URLs or raw SDK/network diagnostics.
const web = readEnvironment('.env.local')
const server = { ...readEnvironment('server/.env.local'), ...process.env }
for (const name of [
  'FIREBASE_PROJECT_ID',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'PROVISIONING_DATABASE_URL',
  'PROVISIONING_DATABASE_CA_FILE',
  'PROVISIONING_ALLOWED_ORIGINS',
]) {
  const value = server[name]
  report(
    `${name} is configured`,
    Boolean(value && !/REPLACE_ME|your-project/.test(value)),
  )
}
report(
  'Frontend and server Firebase projects match',
  Boolean(
    web.VITE_FIREBASE_PROJECT_ID &&
    web.VITE_FIREBASE_PROJECT_ID === server.FIREBASE_PROJECT_ID,
  ),
)
for (const name of [
  'GOOGLE_APPLICATION_CREDENTIALS',
  'PROVISIONING_DATABASE_CA_FILE',
])
  report(
    `${name} file exists`,
    Boolean(server[name] && existsSync(server[name])),
  )

let endpoint
try {
  endpoint = new URL(web.VITE_FIREBASE_PROVISIONING_URL)
  if (
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    endpoint.pathname !== '/provision' ||
    !(
      endpoint.protocol === 'https:' ||
      (endpoint.protocol === 'http:' &&
        ['localhost', '127.0.0.1'].includes(endpoint.hostname))
    )
  )
    throw new Error('Invalid endpoint')
  report('Frontend provisioning URL is valid', true)
} catch {
  endpoint = undefined
  report('Frontend provisioning URL is valid', false)
}
if (endpoint) {
  for (const origin of ['http://localhost:5173', 'http://127.0.0.1:5173']) {
    try {
      const preflight = await fetch(endpoint, {
        method: 'OPTIONS',
        headers: {
          Origin: origin,
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Authorization',
        },
        signal: AbortSignal.timeout(5000),
      })
      report(
        `CORS preflight for ${origin}`,
        preflight.status === 204 &&
          preflight.headers.get('access-control-allow-origin') === origin,
      )
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { Origin: origin },
        signal: AbortSignal.timeout(5000),
      })
      report(
        `Unauthenticated request rejected for ${origin}`,
        response.status === 401,
      )
      const invalidIdentity = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Origin: origin,
          Authorization: 'Bearer invalid-fictional-token',
        },
        signal: AbortSignal.timeout(5000),
      })
      report(
        `Invalid fictional token rejected for ${origin}`,
        invalidIdentity.status === 401,
      )
    } catch {
      report('Provisioning server is reachable', false)
    }
  }
}
console.log(
  'This check does not verify live Admin permissions, apply migrations or provision accounts.',
)
