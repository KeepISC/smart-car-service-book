import assert from 'node:assert/strict'
import { randomBytes, createHash } from 'node:crypto'
import { readFile, mkdtemp, rm, access } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import net from 'node:net'
import pg from 'pg'
import EmbeddedPostgres from '../.tmp/postgres-tools/node_modules/embedded-postgres/dist/index.js'

// This tool creates its own server. It accepts no database connection settings.
const expectedHash =
  '855e575ce4d184e9a3c70ef2d759c76521dcccf08917ad73233f46d5917bff42'
const archive = process.env.SCSB_RECOVERY_ARCHIVE
const restoreBinary = process.env.SCSB_PG_RESTORE
assert.ok(
  archive && restoreBinary,
  'Set private archive and pg_restore executable paths',
)
const checksum = async () =>
  createHash('sha256')
    .update(await readFile(archive))
    .digest('hex')
assert.equal(await checksum(), expectedHash, 'Archive checksum mismatch')
const restore = (args, env = process.env) =>
  execFileSync(restoreBinary, args, {
    encoding: 'utf8',
    env,
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
console.log(restore(['--version']).trim())
const archiveList = restore(['--list', archive])
assert.match(archiveList, /Dumped from database version: 17\.11/)
assert.match(archiveList, /Dumped by pg_dump version: 18\.6/)
assert.ok(
  !/ EXTENSION /.test(archiveList),
  'Review additional extension requirements',
)
const dataSql = restore(['--data-only', '--file=-', archive]).replaceAll(
  '\r\n',
  '\n',
)
const tables = [
  ...dataSql.matchAll(
    /^COPY ([\w.]+) \(([^\n]+)\) FROM stdin;\n([\s\S]*?)^\\\.$/gm,
  ),
]
assert.equal(tables.length, 9)
const expectedCounts = {
  'public.vehicles': 1,
  'public.vehicle_maintenance_items': 5,
  'public.maintenance_templates': 0,
  'public.maintenance_template_items': 0,
  'app_private.app_users': 3,
  'app_private.firebase_config': 1,
  'app_private.firebase_identities': 3,
  'app_private.firebase_provisioning_approvals': 3,
  'supabase_migrations.schema_migrations': 4,
}
// Reserve an unused loopback port, then let PostgreSQL bind it. A bind race fails
// startup rather than attaching to or stopping another server.
const reservation = net.createServer()
await new Promise((resolve, reject) =>
  reservation.once('error', reject).listen(0, '127.0.0.1', resolve),
)
const port = reservation.address().port
await new Promise((resolve) => reservation.close(resolve))
const root = path.resolve('.tmp')
const directory = await mkdtemp(path.join(root, 'recovery-'))
assert.equal(path.dirname(directory), root)
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
let client
let started = false
let stopped
let stage = 'cluster preparation'
let failed = false
try {
  await server.initialise()
  await server.start()
  started = true
  await server.createDatabase('recovery_test')
  client = new pg.Client({
    host: '127.0.0.1',
    port,
    user: 'postgres',
    password,
    database: 'recovery_test',
  })
  await client.connect()
  assert.equal(
    path.resolve(
      (await client.query('show data_directory')).rows[0].data_directory,
    ),
    directory,
  )
  const version = (await client.query('show server_version')).rows[0]
    .server_version
  assert.equal(version, '18.4')
  console.log('PostgreSQL', version)
  await client.query(`
    drop schema public;
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create role supabase_admin nologin;
    create role scsb_provisioner nologin nosuperuser nocreatedb nocreaterole nobypassrls;
    create schema auth;
    grant usage on schema auth to anon, authenticated;
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
    $$;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
        auth.jwt()->>'sub'), '')::uuid;
    $$;
  `)
  assert.ok(
    (
      await client.query(
        "select to_regprocedure('gen_random_uuid()') is not null ok",
      )
    ).rows[0].ok,
  )
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !key.toUpperCase().startsWith('PG'),
    ),
  )
  Object.assign(env, {
    PGHOST: '127.0.0.1',
    PGPORT: String(port),
    PGUSER: 'postgres',
    PGDATABASE: 'recovery_test',
    PGPASSWORD: password,
    PGSSLMODE: 'disable',
  })
  // Keep owners and ACLs; do not use --clean, --create or --no-owner.
  stage = 'archive restore'
  const output = restore(
    [
      '--host=127.0.0.1',
      `--port=${port}`,
      '--username=postgres',
      '--dbname=recovery_test',
      '--exit-on-error',
      '--single-transaction',
      archive,
    ],
    env,
  )
  assert.equal(output.trim(), '')
  console.log('PASS transactional custom-archive restore')
  stage = 'record equality'
  const unescape = (value) =>
    value === '\\N'
      ? null
      : value.replace(/\\([0-7]{1,3}|.)/g, (_, escape) => {
          if (/^[0-7]+$/.test(escape))
            return String.fromCharCode(parseInt(escape, 8))
          return (
            { b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v' }[escape] ??
            escape
          )
        })
  for (const [, table, columns, body] of tables) {
    assert.ok(Object.hasOwn(expectedCounts, table))
    assert.match(columns, /^[a-z_, ]+$/)
    const rows = body
      ? body
          .split(/\r?\n/)
          .filter(Boolean)
          .map((line) => line.split('\t').map(unescape))
      : []
    assert.equal(rows.length, expectedCounts[table])
    await client.query('begin')
    try {
      await client.query(
        `create temporary table expected_records (like ${table}) on commit drop`,
      )
      for (const row of rows)
        await client.query(
          `insert into expected_records (${columns}) values (${row.map((_, i) => `$${i + 1}`).join(',')})`,
          row,
        )
      const mismatch = await client.query(`select count(*)::int n from (
        (select ${columns} from ${table} except all select ${columns} from expected_records)
        union all (select ${columns} from expected_records except all select ${columns} from ${table})
      ) differences`)
      assert.equal(mismatch.rows[0].n, 0)
      await client.query('commit')
    } catch (error) {
      await client.query('rollback')
      throw error
    }
    console.log('PASS archive record equality', table, expectedCounts[table])
  }
  const scalar = async (sql) => (await client.query(sql)).rows[0].n
  stage = 'security metadata'
  assert.equal(
    await scalar(
      "select count(*)::int n from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname in ('public','app_private')",
    ),
    5,
  )
  assert.equal(
    await scalar(
      "select count(*)::int n from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace s on s.oid=c.relnamespace where s.nspname='public' and not t.tgisinternal and t.tgenabled='O'",
    ),
    4,
  )
  assert.equal(
    await scalar(
      "select count(*)::int n from pg_policies where schemaname in ('public','app_private')",
    ),
    10,
  )
  const functionNames = (
    await client.query(
      "select s.nspname||'.'||p.proname name from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname in ('public','app_private') order by name",
    )
  ).rows.map((row) => row.name)
  assert.deepEqual(functionNames, [
    'app_private.provision_firebase_owner',
    'public.current_app_owner',
    'public.set_vehicle_updated_at',
    'public.validate_maintenance_completion',
    'public.validate_vehicle_mileage',
  ])
  for (const [kind, query] of [
    [
      'TRIGGER',
      "select t.tgname name from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace s on s.oid=c.relnamespace where s.nspname='public' and not t.tgisinternal",
    ],
    [
      'POLICY',
      "select policyname name from pg_policies where schemaname in ('public','app_private')",
    ],
  ]) {
    const names = [
      ...archiveList.matchAll(
        new RegExp(` ${kind} public [a-z_]+ ([a-z_]+) postgres`, 'g'),
      ),
    ]
      .map((match) => match[1])
      .sort()
    assert.deepEqual(
      (await client.query(query)).rows.map((row) => row.name).sort(),
      names,
    )
  }
  assert.equal(
    await scalar(
      "select count(*)::int n from pg_class c join pg_namespace s on s.oid=c.relnamespace where s.nspname in ('public','app_private') and c.relkind='r' and c.relrowsecurity and c.relforcerowsecurity",
    ),
    8,
  )
  assert.equal(
    await scalar(
      'select count(*)::int n from public.vehicles v left join app_private.app_users a on a.id=v.owner_id where a.id is null',
    ),
    0,
  )
  assert.equal(
    await scalar(
      'select count(*)::int n from app_private.firebase_identities i left join app_private.app_users a on a.id=i.owner_id where a.id is null',
    ),
    0,
  )
  assert.equal(
    await scalar(
      "select count(*)::int n from pg_constraint where conrelid='public.vehicles'::regclass and confrelid='app_private.app_users'::regclass and contype='f' and convalidated",
    ),
    1,
  )
  assert.equal(
    await scalar(
      "select count(*)::int n from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname in ('public','app_private') and p.prosecdef and p.proconfig @> array['search_path=\"\"']",
    ),
    2,
  )
  const privileges = (
    await client.query(`select
    has_table_privilege('authenticated','public.vehicles','SELECT') and
    has_column_privilege('authenticated','public.vehicles','mileage','UPDATE') and
    not has_table_privilege('anon','public.vehicles','SELECT') and
    not has_table_privilege('authenticated','app_private.firebase_identities','SELECT') and
    has_function_privilege('scsb_provisioner','app_private.provision_firebase_owner(text,text)','EXECUTE') and
    not has_function_privilege('authenticated','app_private.provision_firebase_owner(text,text)','EXECUTE') ok`)
  ).rows[0].ok
  assert.ok(privileges)
  console.log(
    'PASS functions, enabled triggers, policies, forced RLS, ownership foreign key and effective privileges',
  )
  const identities = (
    await client.query(`select i.firebase_uid,i.owner_id,c.project_id from app_private.firebase_identities i
    join app_private.firebase_provisioning_approvals a using(firebase_uid) cross join app_private.firebase_config c where a.enabled`)
  ).rows
  assert.equal(identities.length, 3)
  stage = 'owner isolation'
  for (const identity of identities) {
    await client.query('begin')
    try {
      const claims = {
        iss: `https://securetoken.google.com/${identity.project_id}`,
        aud: identity.project_id,
        sub: identity.firebase_uid,
        app_owner_id: identity.owner_id,
        role: 'authenticated',
        email_verified: true,
      }
      await client.query("select set_config('request.jwt.claims',$1,true)", [
        JSON.stringify(claims),
      ])
      await client.query('set local role authenticated')
      assert.equal(
        (await client.query('select public.current_app_owner() id')).rows[0].id,
        identity.owner_id,
      )
      assert.equal(
        (
          await client.query(
            'select count(*)::int n from public.vehicles where owner_id <> $1',
            [identity.owner_id],
          )
        ).rows[0].n,
        0,
      )
      assert.equal(
        (
          await client.query(
            'select count(*)::int n from public.vehicle_maintenance_items m join public.vehicles v on v.id=m.vehicle_id where v.owner_id <> $1',
            [identity.owner_id],
          )
        ).rows[0].n,
        0,
      )
      assert.equal(
        (
          await client.query(
            'update public.vehicles set mileage=mileage where owner_id <> $1',
            [identity.owner_id],
          )
        ).rowCount,
        0,
      )
    } finally {
      await client.query('rollback')
    }
  }
  console.log(
    'PASS restored Firebase ownership resolution and cross-owner read isolation for all three identities',
  )
  // Invalid local writes must fail and are always rolled back.
  stage = 'mileage rejection'
  await client.query('begin')
  try {
    await assert.rejects(
      client.query('update public.vehicles set mileage=-1'),
      (error) => ['23514', '23502'].includes(error.code),
    )
  } finally {
    await client.query('rollback')
  }
  const vehicle = (
    await client.query('select id,mileage from public.vehicles limit 1')
  ).rows[0]
  await client.query('begin')
  try {
    await assert.rejects(
      client.query(
        "update public.vehicle_maintenance_items set history_status='known',last_completed_date=current_date,last_completed_mileage=$1 where vehicle_id=$2",
        [vehicle.mileage + 1, vehicle.id],
      ),
      (error) => error.code === '23514',
    )
  } finally {
    await client.query('rollback')
  }
  console.log(
    'PASS invalid vehicle and maintenance mileage rejected with rollback',
  )
  await client.query('begin')
  try {
    // This archive has no positive completion baseline. Prepare one only in a
    // rolled-back local transaction to exercise the cross-table trigger.
    await client.query(
      'update public.vehicles set mileage=greatest(mileage,20) where id=$1',
      [vehicle.id],
    )
    await client.query(
      "update public.vehicle_maintenance_items set history_status='known',last_completed_date=current_date,last_completed_mileage=10 where vehicle_id=$1",
      [vehicle.id],
    )
    await assert.rejects(
      client.query('update public.vehicles set mileage=$1 where id=$2', [
        9,
        vehicle.id,
      ]),
      (error) =>
        error.code === '23514' &&
        error.constraint === 'vehicle_maintenance_mileage_consistency',
    )
  } finally {
    await client.query('rollback')
  }
  console.log(
    'PASS vehicle mileage trigger rejects a value below a transaction-local test completion; rolled back',
  )
  assert.equal(await checksum(), expectedHash)
  console.log('PASS original archive checksum unchanged')
} catch (error) {
  // Database/restore errors may contain private rows. Never print raw errors.
  console.error(
    'FAIL stage:',
    stage,
    'code:',
    error.code ?? error.status ?? 'unknown',
    '; raw diagnostics suppressed',
  )
  const dependency = String(error.stderr ?? '').match(
    /(?:role|schema|function|unrecognized configuration parameter) "([a-z_().]+)" (?:does not exist|already exists)?/,
  )
  if (dependency) console.error('Dependency identifier:', dependency[1])
  process.exitCode = 1
  failed = true
} finally {
  if (client) await client.end()
  const hasPid = await access(path.join(directory, 'postmaster.pid')).then(
    () => true,
    () => false,
  )
  if (started || hasPid) {
    const control = path.resolve(
      '.tmp/postgres-tools/node_modules/@embedded-postgres/windows-x64/native/bin/pg_ctl.exe',
    )
    execFileSync(control, ['-D', directory, '-m', 'fast', '-w', 'stop'], {
      stdio: 'pipe',
    })
    // pg_ctl performs graceful shutdown; avoid the library's Windows taskkill
    // fallback and its exit hook attempting to stop an already exited child.
    server.process = undefined
  }
  stopped = true
  if (stopped) {
    assert.equal(
      await access(path.join(directory, 'postmaster.pid')).then(
        () => true,
        () => false,
      ),
      false,
      'Preserve cluster directory if shutdown is unconfirmed',
    )
    assert.equal(path.dirname(directory), root)
    assert.match(path.basename(directory), /^recovery-/)
    await rm(directory, { recursive: true, force: true })
    console.log(
      'CLEANUP own disposable server stopped and exact cluster directory removed',
    )
  }
}
// Explicit exit preserves failures with the embedded library's exit hook.
process.exit(failed ? 1 : 0)
