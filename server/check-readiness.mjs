import { randomUUID } from 'node:crypto'
import {
  applicationDefault,
  deleteApp,
  initializeApp,
} from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import pg from 'pg'
import {
  parseDatabaseUrl,
  loadDatabaseCa,
  databaseOptions,
} from './database-config.mjs'
import { lookup } from 'node:dns/promises'
import { createConnection } from 'node:net'

const projectId = 'smart-car-service-book-61a9d'
let app
let database
let stage = 'environment configuration'

function report(label, passed) {
  console.log(`${passed ? 'PASS' : 'FAIL'}: ${label}`)
  if (!passed) process.exitCode = 1
}

function readinessDatabaseOptions() {
  stage = 'environment configuration'
  for (const name of [
    'FIREBASE_PROJECT_ID',
    'GOOGLE_APPLICATION_CREDENTIALS',
    'PROVISIONING_DATABASE_URL',
    'PROVISIONING_DATABASE_CA_FILE',
  ]) {
    if (!process.env[name])
      throw new Error('Missing required environment variable')
    report(`${name} is present`, true)
  }
  stage = 'PostgreSQL URL configuration'
  const connection = parseDatabaseUrl(process.env.PROVISIONING_DATABASE_URL)
  report(
    'Restricted PostgreSQL URL and password encoding syntax are valid',
    true,
  )
  stage = 'CA certificate validation'
  const ca = loadDatabaseCa(process.env.PROVISIONING_DATABASE_CA_FILE)
  report('CA certificate is readable and currently valid', true)
  return databaseOptions(connection, ca, 1)
}

async function verifyFirebase() {
  stage = 'Firebase credentials'
  if (
    process.env.FIREBASE_PROJECT_ID !== projectId ||
    process.env.FIREBASE_AUTH_EMULATOR_HOST
  )
    throw new Error('Wrong Firebase project or emulator configuration')
  app = initializeApp({ projectId, credential: applicationDefault() })
  await app.options.credential.getAccessToken()
  report('Firebase Admin credentials initialize and authenticate', true)
  stage = 'Firebase user-read API'
  try {
    // A random fictional UID checks read permissions without listing accounts.
    await getAuth(app).getUser(`scsb-readiness-${randomUUID()}`)
    report('Firebase Authentication user-read API is accessible', true)
  } catch (error) {
    if (error.code !== 'auth/user-not-found') throw error
    report('Firebase Authentication user-read API is accessible', true)
  }
}

async function verifyDatabase() {
  const options = readinessDatabaseOptions()
  stage = 'PostgreSQL DNS resolution'
  await lookup(options.host)
  report('PostgreSQL hostname resolves', true)
  stage = 'PostgreSQL TCP connectivity'
  await new Promise((resolve, reject) => {
    const socket = createConnection({
      host: options.host,
      port: options.port,
    })
    socket.setTimeout(10000)
    socket.once('connect', () => {
      socket.destroy()
      resolve()
    })
    socket.once('error', reject)
    socket.once('timeout', () => {
      socket.destroy()
      reject(Object.assign(new Error('Timeout'), { code: 'ETIMEDOUT' }))
    })
  })
  report('PostgreSQL TCP port is reachable', true)
  stage = 'PostgreSQL TLS and authentication'
  database = new pg.Pool(options)
  await database.query('select 1')
  report(
    'PostgreSQL connection succeeds with trusted TLS and authentication',
    true,
  )
  stage = 'PostgreSQL provisioning permissions'
  const { rows } = await database.query(`
    select
      current_database() = 'postgres' as expected_database,
      current_user = 'scsb_provisioning_local' as expected_login,
      r.rolcanlogin and r.rolinherit and not r.rolsuper and not r.rolcreatedb
        and not r.rolcreaterole and not r.rolreplication and not r.rolbypassrls
        as restricted_login,
      pg_has_role(current_user, 'scsb_provisioner', 'USAGE') as provisioner_inherited,
      not exists (
        select 1 from pg_auth_members m join pg_roles parent on parent.oid=m.roleid
        where m.member=r.oid and (parent.rolname <> 'scsb_provisioner' or m.admin_option)
      ) as restricted_memberships,
      has_schema_privilege(current_user, 'app_private', 'USAGE') as private_usage,
      not has_schema_privilege(current_user, 'app_private', 'CREATE') as no_private_create,
      not has_schema_privilege(current_user, 'public', 'CREATE') as no_public_create,
      has_function_privilege(current_user,
        'app_private.provision_firebase_owner(text,text)', 'EXECUTE') as provision_execute,
      not exists (
        select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname in ('public','app_private','auth') and c.relkind in ('r','p','v','m','f')
          and (has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
            or has_any_column_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,REFERENCES'))
      ) as no_direct_data_access
    from pg_roles r where r.rolname=current_user
  `)
  const permissions = rows[0]
  const permissionLabels = {
    expected_database: 'Expected database',
    expected_login: 'Authenticated restricted runtime login',
    restricted_login: 'Login has no elevated attributes',
    provisioner_inherited: 'Provisioner role is inherited',
    restricted_memberships:
      'Memberships are restricted to provisioner without admin option',
    private_usage: 'Private schema USAGE is available',
    no_private_create: 'Private schema CREATE is denied',
    no_public_create: 'Public schema CREATE is denied',
    provision_execute:
      'Provisioning function EXECUTE is available (function not invoked)',
    no_direct_data_access: 'Direct application data access is denied',
  }
  for (const [key, label] of Object.entries(permissionLabels))
    report(label, permissions?.[key] === true)
  report(
    'Runtime login inherits provisioning only, without direct data access or elevated privileges',
    Boolean(
      permissions &&
      Object.values(permissions).every((value) => value === true),
    ),
  )
}

try {
  await verifyFirebase()
  await verifyDatabase()
} catch (error) {
  // SDK and PostgreSQL diagnostics may expose credentials or connection details.
  report(`${stage} failed (${safeErrorCode(error)})`, false)
} finally {
  if (database) await database.end()
  if (app) await deleteApp(app)
}
console.log(
  'Read-only check: no users, claims, owners or database records were created or changed. Claim-write permissions and real JWT acceptance need a separate fictional-account login test.',
)

function safeErrorCode(error) {
  // Only known codes cross this boundary; messages and connection details stay private.
  const allowed = new Set([
    '28P01',
    '28000',
    '42501',
    '42883',
    '3F000',
    '3D000',
    'ENOTFOUND',
    'EAI_AGAIN',
    'ECONNREFUSED',
    'ECONNRESET',
    'ETIMEDOUT',
    'ENOENT',
    'EACCES',
    'CERT_HAS_EXPIRED',
    'DEPTH_ZERO_SELF_SIGNED_CERT',
    'SELF_SIGNED_CERT_IN_CHAIN',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
    'ERR_TLS_CERT_ALTNAME_INVALID',
    'DATABASE_URL_INVALID',
    'DATABASE_ENDPOINT_OR_LOGIN_INVALID',
    'DATABASE_PASSWORD_ENCODING_INVALID',
    'DATABASE_CA_MISSING',
    'DATABASE_CA_INVALID',
  ])
  if (error?.code === '28P01') return '28P01: authentication / invalid password'
  if (error?.code === '42501') return '42501: database permissions'
  return allowed.has(error?.code)
    ? error.code
    : 'configuration or unclassified runtime error'
}
