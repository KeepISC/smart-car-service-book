// Uses only fictional schemas in a new loopback cluster; no connection settings.
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import net from 'node:net'
import path from 'node:path'
import pg from 'pg'
import EmbeddedPostgres from '../.tmp/postgres17-tools/node_modules/embedded-postgres/dist/index.js'
import {
  preparePublicSchemaRestore,
  readRecoverySchemaSecurity,
} from './recovery-public-schema.mjs'

const root = path.resolve('.tmp')
const directory = await mkdtemp(path.join(root, 'recovery-acl-'))
assert.equal(path.dirname(directory), root)
const reservation = net.createServer()
await new Promise((resolve, reject) =>
  reservation.once('error', reject).listen(0, '127.0.0.1', resolve),
)
const port = reservation.address().port
await new Promise((resolve) => reservation.close(resolve))
const password = randomBytes(24).toString('hex')
const server = new EmbeddedPostgres({
  databaseDir: directory,
  user: 'postgres',
  password,
  port,
  persistent: true,
  createPostgresUser: false,
  postgresFlags: ['-h', '127.0.0.1'],
  onLog: () => {},
  onError: () => {},
})
const dumpBinary =
  process.env.SCSB_PG_DUMP ?? 'C:/Program Files/PostgreSQL/18/bin/pg_dump.exe'
const restoreBinary =
  process.env.SCSB_PG_RESTORE ??
  'C:/Program Files/PostgreSQL/18/bin/pg_restore.exe'
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) => !key.toUpperCase().startsWith('PG'),
  ),
)
Object.assign(env, {
  PGHOST: '127.0.0.1',
  PGPORT: String(port),
  PGUSER: 'postgres',
  PGPASSWORD: password,
  PGSSLMODE: 'disable',
})
const run = (binary, args, database) =>
  execFileSync(binary, args, {
    env: { ...env, PGDATABASE: database },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
const connections = []
let started = false
try {
  await server.initialise()
  await server.start()
  started = true
  const connect = async (database) => {
    const client = new pg.Client({
      host: '127.0.0.1',
      port,
      user: 'postgres',
      password,
      database,
    })
    await client.connect()
    connections.push(client)
    assert.equal(
      path.resolve(
        (await client.query('show data_directory')).rows[0].data_directory,
      ),
      directory,
    )
    return client
  }
  const admin = await connect('postgres')
  await admin.query(
    'create role fictional_reader nologin; create role fictional_editor nologin',
  )
  await server.createDatabase('acl_source')
  const source = await connect('acl_source')
  await source.query(`grant usage on schema public to fictional_reader;
    grant usage,create on schema public to fictional_editor;
    alter default privileges for role postgres in schema public grant select on tables to fictional_reader`)
  const expected = await readRecoverySchemaSecurity(source)
  const archive = path.join(directory, 'fictional.dump')
  run(
    dumpBinary,
    ['--format=custom', '--schema=public', '--file=' + archive],
    'acl_source',
  )
  const archiveList = run(restoreBinary, ['--list', archive], 'acl_source')
  await server.createDatabase('acl_broken')
  const broken = await connect('acl_broken')
  await broken.query('drop schema public')
  run(
    restoreBinary,
    ['--dbname=acl_broken', '--exit-on-error', '--single-transaction', archive],
    'acl_broken',
  )
  const failed = await readRecoverySchemaSecurity(broken)
  assert.deepEqual(
    failed.schemas[0].acl,
    expected.schemas[0].acl.filter((acl) => acl !== '=U/pg_database_owner'),
  )
  assert.deepEqual(failed.defaults, expected.defaults)
  assert.throws(() => assert.deepEqual(failed, expected))
  console.log(
    'PASS reproduces lost PUBLIC USAGE while named grants/default privileges remain intact',
  )

  await server.createDatabase('acl_fixed')
  const fixed = await connect('acl_fixed')
  const restoreList = path.join(directory, 'fixed.list')
  await preparePublicSchemaRestore(fixed, archiveList, restoreList)
  run(
    restoreBinary,
    [
      '--dbname=acl_fixed',
      '--exit-on-error',
      '--single-transaction',
      '--use-list=' + restoreList,
      archive,
    ],
    'acl_fixed',
  )
  assert.deepEqual(await readRecoverySchemaSecurity(fixed), expected)
  await fixed.query('grant create on schema public to fictional_reader')
  const extraGrant = await readRecoverySchemaSecurity(fixed)
  assert.throws(() => assert.deepEqual(extraGrant, expected))
  await assert.rejects(
    preparePublicSchemaRestore(
      fixed,
      archiveList,
      path.join(directory, 'invalid.list'),
    ),
    /untouched PostgreSQL public schema/,
  )
  console.log(
    'PASS exact ACL/owner/default grants restored; extra CREATE and altered bootstrap remain detectable',
  )

  await source.query('revoke usage on schema public from public')
  const revokedExpected = await readRecoverySchemaSecurity(source)
  const revokedArchive = path.join(directory, 'revoked.dump')
  run(
    dumpBinary,
    ['--format=custom', '--schema=public', '--file=' + revokedArchive],
    'acl_source',
  )
  await server.createDatabase('acl_revoked')
  const revoked = await connect('acl_revoked')
  const revokedList = path.join(directory, 'revoked.list')
  await preparePublicSchemaRestore(
    revoked,
    run(restoreBinary, ['--list', revokedArchive], 'acl_source'),
    revokedList,
  )
  run(
    restoreBinary,
    [
      '--dbname=acl_revoked',
      '--exit-on-error',
      '--single-transaction',
      '--use-list=' + revokedList,
      revokedArchive,
    ],
    'acl_revoked',
  )
  assert.deepEqual(await readRecoverySchemaSecurity(revoked), revokedExpected)
  assert.ok(!revokedExpected.schemas[0].acl.some((acl) => acl.startsWith('=')))
  console.log(
    'PASS archived PUBLIC USAGE revocation preserved; no missing grant is ignored or added',
  )
} catch (error) {
  console.error(
    'FAIL focused recovery ACL regression; code:',
    error.code ?? 'unknown',
    '; private diagnostics suppressed',
  )
  process.exitCode = 1
} finally {
  await Promise.all(connections.map((client) => client.end().catch(() => {})))
  const hasPid = await access(path.join(directory, 'postmaster.pid')).then(
    () => true,
    () => false,
  )
  if (started || hasPid) {
    execFileSync(
      path.resolve(
        '.tmp/postgres17-tools/node_modules/@embedded-postgres/windows-x64/native/bin/pg_ctl.exe',
      ),
      ['-D', directory, '-m', 'fast', '-w', 'stop'],
      { stdio: 'pipe' },
    )
    server.process = undefined
  }
  assert.equal(
    await access(path.join(directory, 'postmaster.pid')).then(
      () => true,
      () => false,
    ),
    false,
  )
  assert.equal(path.dirname(directory), root)
  assert.match(path.basename(directory), /^recovery-acl-/)
  await rm(directory, { recursive: true, force: true })
  console.log('CLEANUP own fictional ACL test cluster stopped and removed')
}
process.exit(process.exitCode ?? 0)
