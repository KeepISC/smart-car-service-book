import { createServer } from 'node:http'
import { applicationDefault, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import pg from 'pg'
import { provisionIdentity } from './provisioning.mjs'
import { provisioningHandler } from './http.mjs'
import {
  parseDatabaseUrl,
  loadDatabaseCa,
  databaseOptions,
} from './database-config.mjs'

const projectId = process.env.FIREBASE_PROJECT_ID
const connectionString = process.env.PROVISIONING_DATABASE_URL
const certificatePath = process.env.PROVISIONING_DATABASE_CA_FILE
const allowedOrigins = (process.env.PROVISIONING_ALLOWED_ORIGINS ?? '')
  .split(',')
  .filter(Boolean)
const port = Number(process.env.PORT ?? 8787)
function safeDatabaseUrl(value) {
  try {
    parseDatabaseUrl(value)
    return true
  } catch {
    return false
  }
}
if (
  !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId ?? '') ||
  !safeDatabaseUrl(connectionString) ||
  !certificatePath ||
  !allowedOrigins.length ||
  allowedOrigins.some((origin) => {
    try {
      const parsed = new URL(origin)
      return (
        parsed.origin !== origin ||
        !(
          parsed.protocol === 'https:' ||
          (parsed.protocol === 'http:' &&
            ['localhost', '127.0.0.1'].includes(parsed.hostname))
        )
      )
    } catch {
      return true
    }
  }) ||
  !Number.isInteger(port) ||
  port < 1 ||
  port > 65535 ||
  process.env.FIREBASE_AUTH_EMULATOR_HOST
) {
  throw new Error(
    'Configure the trusted provisioning service environment. Emulator authentication is not supported here.',
  )
}

let auth
let database
try {
  auth = getAuth(initializeApp({ projectId, credential: applicationDefault() }))
  database = new pg.Pool(
    databaseOptions(
      parseDatabaseUrl(connectionString),
      loadDatabaseCa(certificatePath),
    ),
  )
} catch {
  // Credential loaders may include private file content in their diagnostics.
  throw new Error(
    'Provisioning credentials or database certificate could not be loaded.',
  )
}
// Database diagnostics can contain connection information; log only a fixed message.
database.on('error', () =>
  console.error('Provisioning database connection failed.'),
)
const server = createServer(
  provisioningHandler({
    allowedOrigins,
    provision: (token) =>
      provisionIdentity(token, { auth, database, projectId }),
  }),
)
server.requestTimeout = 20000
server.headersTimeout = 10000
server.maxHeadersCount = 30
// Put this loopback listener behind a TLS reverse proxy with request/concurrency limits.
server.listen(port, '127.0.0.1', () =>
  console.log('Trusted provisioning service listening on loopback.'),
)
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => void database.end()))
}
