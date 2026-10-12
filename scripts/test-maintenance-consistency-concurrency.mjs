// Only a disposable local database may receive these fictional fixtures.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import pg from 'pg'

if (
  process.env.SCSB_DISPOSABLE_DATABASE_TEST !== 'true' ||
  process.env.PGHOST !== 'localhost' ||
  process.env.PGDATABASE !== 'maintenance_test' ||
  process.env.PGUSER !== 'postgres' ||
  process.env.PGPORT !== '5432'
) {
  throw new Error(
    'Maintenance concurrency tests require the disposable local database.',
  )
}
const pool = new pg.Pool({
  max: 3,
  connectionTimeoutMillis: 5000,
  statement_timeout: 15000,
})
const owner = randomUUID()
const vehicle = randomUUID()
const item = randomUUID()
const uid = `fictional-maintenance-${owner}`
const admin = await pool.connect()
const first = await pool.connect()
const second = await pool.connect()
let previousProject
async function begin(connection, isolation) {
  await connection.query(`begin isolation level ${isolation}`)
  await connection.query('select set_config($1, $2, true)', [
    'request.jwt.claims',
    JSON.stringify({
      iss: 'https://securetoken.google.com/fictional-project',
      aud: 'fictional-project',
      sub: uid,
      role: 'authenticated',
      email_verified: true,
      app_owner_id: owner,
    }),
  ])
  await connection.query('set local role authenticated')
  // Establish the snapshot before the competing transaction commits.
  await connection.query('select mileage from public.vehicles where id=$1', [
    vehicle,
  ])
}
async function waitForLock(pid) {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    const result = await admin.query(
      'select wait_event_type from pg_stat_activity where pid=$1',
      [pid],
    )
    if (result.rows[0]?.wait_event_type === 'Lock') return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('Competing write did not wait for the parent vehicle lock')
}
try {
  previousProject = (
    await admin.query(
      'select project_id from app_private.firebase_config where singleton',
    )
  ).rows[0].project_id
  await admin.query(
    "update app_private.firebase_config set project_id='fictional-project' where singleton",
  )
  await admin.query('insert into app_private.app_users(id) values ($1)', [
    owner,
  ])
  await admin.query(
    'insert into app_private.firebase_identities(firebase_uid,owner_id) values ($1,$2)',
    [uid, owner],
  )
  await admin.query(
    'insert into app_private.firebase_provisioning_approvals(firebase_uid) values ($1)',
    [uid],
  )
  await admin.query(
    "insert into public.vehicles(id,owner_id,type,make,model,year,engine,mileage) values ($1,$2,'car','Fictional','Concurrency',2020,'Example',20000)",
    [vehicle, owner],
  )
  const pid = (await second.query('select pg_backend_pid() as pid')).rows[0].pid
  for (const isolation of [
    'read committed',
    'repeatable read',
    'serializable',
  ]) {
    for (const maintenanceFirst of [true, false]) {
      for (const edit of [false, true]) {
        await admin.query(
          'delete from public.vehicle_maintenance_items where vehicle_id=$1',
          [vehicle],
        )
        await admin.query(
          'update public.vehicles set mileage=20000 where id=$1',
          [vehicle],
        )
        if (edit)
          await admin.query(
            "insert into public.vehicle_maintenance_items(id,vehicle_id,name,interval_km,history_status,last_completed_mileage) values ($1,$2,'Fictional completion',1000,'known',5000)",
            [item, vehicle],
          )
        await begin(first, isolation)
        await begin(second, isolation)
        const mileageWrite = (connection) =>
          connection.query(
            'update public.vehicles set mileage=10000 where id=$1',
            [vehicle],
          )
        const completionWrite = (connection) =>
          edit
            ? connection.query(
                'update public.vehicle_maintenance_items set last_completed_mileage=18000 where id=$1',
                [item],
              )
            : connection.query(
                "insert into public.vehicle_maintenance_items(vehicle_id,name,interval_km,history_status,last_completed_mileage) values ($1,'Fictional completion',1000,'known',18000)",
                [vehicle],
              )
        await (maintenanceFirst ? completionWrite(first) : mileageWrite(first))
        const pending = (
          maintenanceFirst ? mileageWrite(second) : completionWrite(second)
        ).then(
          () => null,
          (error) => error,
        )
        await waitForLock(pid)
        await first.query('commit')
        const failure = await pending
        assert.ok(failure, 'Both incompatible writes committed')
        assert.equal(
          failure.code,
          isolation === 'read committed' ? '23514' : '40001',
        )
        await second.query('rollback')
        const result = await admin.query(
          'select v.mileage, max(m.last_completed_mileage) as completion from public.vehicles v left join public.vehicle_maintenance_items m on m.vehicle_id=v.id where v.id=$1 group by v.id',
          [vehicle],
        )
        assert.ok(
          result.rows[0].completion === null ||
            result.rows[0].mileage >= result.rows[0].completion,
        )
      }
    }
  }
  console.log(
    'PASS: 12 authenticated concurrent insert/edit races, both write orders, all three isolation levels.',
  )
} finally {
  await first.query('rollback')
  await second.query('rollback')
  await admin.query('delete from app_private.app_users where id=$1', [owner])
  await admin.query(
    'delete from app_private.firebase_provisioning_approvals where firebase_uid=$1',
    [uid],
  )
  if (previousProject !== undefined)
    await admin.query(
      'update app_private.firebase_config set project_id=$1 where singleton',
      [previousProject],
    )
  first.release()
  second.release()
  admin.release()
  await pool.end()
}
