import { readFileSync } from 'node:fs'
import { X509Certificate } from 'node:crypto'

export class DatabaseConfigurationError extends Error {
  constructor(code) {
    super('Invalid provisioning database configuration')
    this.code = code
  }
}

export function parseDatabaseUrl(value) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new DatabaseConfigurationError('DATABASE_URL_INVALID')
  }
  // Reject query overrides: pg can replace credentials and TLS settings from them.
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    url.search ||
    url.hash ||
    url.port !== '5432' ||
    url.pathname !== '/postgres'
  )
    throw new DatabaseConfigurationError('DATABASE_URL_INVALID')

  const projectReference = 'ttwlscydylnaogawmgce'
  const restrictedLogin = 'scsb_provisioning_local'
  const isSessionPooler = /^[a-z0-9-]+\.pooler\.supabase\.com$/.test(
    url.hostname,
  )
  const isDirect = url.hostname === `db.${projectReference}.supabase.co`
  const expectedUser = isSessionPooler
    ? `${restrictedLogin}.${projectReference}`
    : restrictedLogin
  if ((!isSessionPooler && !isDirect) || url.username !== expectedUser)
    throw new DatabaseConfigurationError('DATABASE_ENDPOINT_OR_LOGIN_INVALID')
  if (!url.password || /%(?![0-9a-f]{2})/i.test(url.password))
    throw new DatabaseConfigurationError('DATABASE_PASSWORD_ENCODING_INVALID')

  let password
  try {
    // Decode exactly once. A literal % sequence in a real password must survive.
    password = decodeURIComponent(url.password)
  } catch {
    throw new DatabaseConfigurationError('DATABASE_PASSWORD_ENCODING_INVALID')
  }
  return {
    host: url.hostname,
    port: Number(url.port),
    database: 'postgres',
    user: expectedUser,
    password,
  }
}

export function loadDatabaseCa(path) {
  if (!path) throw new DatabaseConfigurationError('DATABASE_CA_MISSING')
  const ca = readFileSync(path, 'utf8')
  let certificate
  try {
    certificate = new X509Certificate(ca)
  } catch {
    throw new DatabaseConfigurationError('DATABASE_CA_INVALID')
  }
  if (
    !certificate.ca ||
    Date.parse(certificate.validFrom) > Date.now() ||
    Date.parse(certificate.validTo) <= Date.now()
  )
    throw new DatabaseConfigurationError('DATABASE_CA_INVALID')
  return ca
}

export function databaseOptions(connection, ca, max = 5) {
  return {
    ...connection,
    // Explicit options prevent URL SSL parameters and PGSSLMODE weakening TLS.
    ssl: { ca, rejectUnauthorized: true, servername: connection.host },
    sslnegotiation: 'postgres',
    max,
    connectionTimeoutMillis: 10000,
    query_timeout: 15000,
  }
}
