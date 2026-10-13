import assert from 'node:assert/strict'
import { randomBytes, createHash } from 'node:crypto'
import { readFile, mkdtemp, rm, access } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import net from 'node:net'
import { isDeepStrictEqual } from 'node:util'
import pg from 'pg'
const major = process.env.SCSB_RECOVERY_POSTGRES_MAJOR ?? '18'
assert.ok(
  ['17', '18'].includes(major),
  'Unsupported disposable PostgreSQL version',
)
const { default: EmbeddedPostgres } = await import(
  major === '17'
    ? '../.tmp/postgres17-tools/node_modules/embedded-postgres/dist/index.js'
    : '../.tmp/postgres-tools/node_modules/embedded-postgres/dist/index.js'
)

// This tool creates its own server. It accepts no database connection settings.
const manifestPath = process.env.SCSB_RECOVERY_MANIFEST
const manifest = manifestPath
  ? JSON.parse(await readFile(manifestPath, 'utf8'))
  : null
const expectedHash =
  manifest?.sha256 ??
  '855e575ce4d184e9a3c70ef2d759c76521dcccf08917ad73233f46d5917bff42'
const archive = process.env.SCSB_RECOVERY_ARCHIVE
const restoreBinary = process.env.SCSB_PG_RESTORE
assert.ok(
  archive && restoreBinary,
  'Set private archive and pg_restore executable paths',
)
if (manifest) {
  const privateRoot = path.resolve('C:/private/scsb/backups')
  assert.equal(path.dirname(path.resolve(archive)), privateRoot)
  assert.equal(path.resolve(manifest.archive), path.resolve(archive))
  assert.equal(manifestPath, archive + '.manifest.json')
  assert.equal(manifest.project, 'ttwlscydylnaogawmgce')
  assert.equal(manifest.snapshot_consistent, true)
  assert.match(expectedHash, /^[a-f0-9]{64}$/)
  assert.equal(
    (await readFile(archive + '.sha256', 'utf8')).split(/\s/)[0],
    expectedHash,
  )
}
const hasServiceHistory = Boolean(
  manifest?.counts?.['public.service_visits'] !== undefined,
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
assert.equal(tables.length, hasServiceHistory ? 11 : 9)
const expectedCounts = manifest?.counts ?? {
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
  assert.equal(version, major === '17' ? '17.10' : '18.4')
  console.log('PostgreSQL', version)
  await client.query("set timezone='UTC'")
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
  if (manifest) {
    stage = 'source snapshot schema equality'
    const restored = (
      await client.query(
        await readFile('docs/application-backup-metadata.sql', 'utf8'),
      )
    ).rows[0].catalog
    // Earlier capture revisions encoded ACLs as text. Compare ordered ACL entries.
    const normalizeCatalog = async (catalog) =>
      Object.fromEntries(
        await Promise.all(
          Object.entries(catalog).map(async ([key, entries]) => [
            key,
            entries
              ? await Promise.all(
                  entries.map(async (entry) => {
                    if (
                      !Object.hasOwn(entry, 'acl') ||
                      Array.isArray(entry.acl)
                    )
                      return entry
                    const acl = entry.acl
                    if (key === 'table_acl' && acl === null) {
                      // The original manifest used raw relacl too. Expand its NULL using
                      // the recorded owner, keeping explicit empty/revoked ACLs distinct.
                      const owner = catalog.tables.find(
                        (table) =>
                          table.schema === entry.schema &&
                          table.name === entry.table,
                      )?.owner
                      assert.ok(
                        owner,
                        'Missing recorded table owner for default ACL',
                      )
                      const defaults = await client.query(
                        "select array(select unnest(acldefault('r', $1::regrole))::text order by 1) acl",
                        [owner],
                      )
                      return { ...entry, acl: defaults.rows[0].acl }
                    }
                    assert.ok(
                      acl === null || !/["\\]/.test(acl),
                      'Unexpected ACL encoding',
                    )
                    return {
                      ...entry,
                      acl: acl
                        ? acl.slice(1, -1).split(',').filter(Boolean).sort()
                        : [],
                    }
                  }),
                )
              : null,
          ]),
        ),
      )
    const source = await normalizeCatalog(manifest.catalog)
    const local = await normalizeCatalog(restored)
    for (const key of Object.keys(source)) {
      if (!isDeepStrictEqual(local[key], source[key])) {
        const differences = []
        const compare = (actual, expected, location) => {
          if (isDeepStrictEqual(actual, expected)) return
          if (
            actual &&
            expected &&
            typeof actual === 'object' &&
            typeof expected === 'object'
          ) {
            for (const field of new Set([
              ...Object.keys(actual),
              ...Object.keys(expected),
            ]))
              compare(actual[field], expected[field], location + '.' + field)
          } else {
            const summarize = (value) => ({
              type: typeof value,
              sha256: createHash('sha256')
                .update(JSON.stringify(value) ?? 'undefined')
                .digest('hex'),
            })
            differences.push({
              path: location,
              actual: summarize(actual),
              expected: summarize(expected),
            })
          }
        }
        compare(local[key], source[key], key)
        console.error(
          'Schema assertion differs:',
          key,
          '; fields:',
          differences.map((item) => item.path).join(', '),
        )
        console.error(
          'Expected/actual metadata fingerprints:',
          JSON.stringify(differences),
        )
      }
      assert.deepEqual(
        local[key],
        source[key],
        `Restored schema section differs: ${key}`,
      )
    }
    for (const [table, expected] of Object.entries(manifest.fingerprints)) {
      assert.match(table, /^(public|app_private|supabase_migrations)\.[a-z_]+$/)
      const actual = (
        await client.query(
          `select count(*)::int count,encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,'[]'),'UTF8')),'hex') hash from ${table} t`,
        )
      ).rows[0]
      assert.deepEqual(
        actual,
        expected,
        'Restored source snapshot fingerprint differs',
      )
    }
    assert.deepEqual(
      (
        await client.query(
          'select version,name,statements from supabase_migrations.schema_migrations order by version',
        )
      ).rows,
      manifest.history,
      'Restored migration ledger differs',
    )
    assert.equal(
      (
        await client.query(
          "select to_regclass('public.vehicle_mileage_history') is null absent",
        )
      ).rows[0].absent,
      true,
    )
    console.log(
      'PASS source snapshot schema, owners, table/column/function ACLs, all row fingerprints and five predecessor migration records; Task 5 remains unapplied',
    )
    stage = 'ACL comparison regression'
    await client.query('begin')
    try {
      await client.query(
        'create table app_private.fictional_recovery_acl_probe (id integer)',
      )
      const probeAcl = async () =>
        (
          await client.query(
            await readFile('docs/application-backup-metadata.sql', 'utf8'),
          )
        ).rows[0].catalog.table_acl.find(
          (entry) => entry.table === 'fictional_recovery_acl_probe',
        )
      assert.equal(
        (
          await client.query(
            "select relacl is null implicit from pg_class where oid='app_private.fictional_recovery_acl_probe'::regclass",
          )
        ).rows[0].implicit,
        true,
      )
      const implicit = await probeAcl()
      await client.query(
        'grant all on app_private.fictional_recovery_acl_probe to postgres',
      )
      assert.deepEqual(
        await probeAcl(),
        implicit,
        'Explicit default owner grants must equal implicit defaults',
      )
      await client.query(
        'grant select on app_private.fictional_recovery_acl_probe to authenticated',
      )
      assert.ok(
        !isDeepStrictEqual(await probeAcl(), implicit),
        'Extra client grants must remain detectable',
      )
      await client.query(
        'revoke select on app_private.fictional_recovery_acl_probe from authenticated',
      )
      assert.deepEqual(
        await probeAcl(),
        implicit,
        'Removing extra grants must restore the original ACL',
      )
      await client.query(
        'revoke select on app_private.fictional_recovery_acl_probe from postgres',
      )
      assert.ok(
        !isDeepStrictEqual(await probeAcl(), implicit),
        'Revoked owner privileges must remain detectable',
      )
    } finally {
      await client.query('rollback')
    }
    console.log(
      'PASS ACL regression: implicit/explicit owner defaults equivalent; changed client and owner grants detected; fictional probe rolled back',
    )
  }
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
    hasServiceHistory ? 8 : 5,
  )
  assert.equal(
    await scalar(
      "select count(*)::int n from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace s on s.oid=c.relnamespace where s.nspname='public' and not t.tgisinternal and t.tgenabled='O'",
    ),
    hasServiceHistory ? 7 : 4,
  )
  assert.equal(
    await scalar(
      "select count(*)::int n from pg_policies where schemaname in ('public','app_private')",
    ),
    hasServiceHistory ? 12 : 10,
  )
  const functionNames = (
    await client.query(
      "select s.nspname||'.'||p.proname name from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname in ('public','app_private') order by name",
    )
  ).rows.map((row) => row.name)
  assert.deepEqual(
    functionNames,
    [
      'app_private.provision_firebase_owner',
      'public.current_app_owner',
      'public.set_vehicle_updated_at',
      'public.validate_maintenance_completion',
      'public.validate_vehicle_mileage',
      ...(hasServiceHistory
        ? [
            'public.delete_service_visit',
            'public.save_service_visit',
            'public.validate_service_visit',
          ]
        : []),
    ].sort(),
  )
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
    hasServiceHistory ? 10 : 8,
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
    hasServiceHistory ? 4 : 2,
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
  assert.equal(
    identities.length,
    hasServiceHistory ? manifest.counts['app_private.firebase_identities'] : 3,
  )
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
    'PASS restored Firebase ownership resolution and cross-owner read isolation for restored enabled identities',
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
    // Use an independent fictional completion, leaving restored history untouched.
    await client.query(
      'update public.vehicles set mileage=greatest(mileage,20) where id=$1',
      [vehicle.id],
    )
    await client.query(
      "insert into public.vehicle_maintenance_items(vehicle_id,name,interval_km,history_status,last_completed_date,last_completed_mileage) values ($1,'Fictional recovery guard',1000,'known',current_date,10)",
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
