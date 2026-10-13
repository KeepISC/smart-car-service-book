// Fictional fixtures only; never use a production database or local tunnel.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import pg from 'pg'

if (
  process.env.SCSB_DISPOSABLE_DATABASE_TEST !== 'true' ||
  process.env.PGHOST !== 'localhost' ||
  process.env.PGPORT !== '5432' ||
  process.env.PGDATABASE !== 'maintenance_test' ||
  process.env.PGUSER !== 'postgres'
)
  throw new Error('Legacy/service races require the disposable local database')

const pool = new pg.Pool({
  max: 3,
  connectionTimeoutMillis: 5000,
  statement_timeout: 15000,
})
const admin = await pool.connect(),
  first = await pool.connect(),
  second = await pool.connect()
const owner = randomUUID(),
  vehicle = randomUUID(),
  schedule = randomUUID()
const uid = `fictional-legacy-race-${owner}`
let previousProject
async function begin(connection, isolation) {
  await connection.query(`begin isolation level ${isolation}`)
  await connection.query('select set_config($1,$2,true)', [
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
  await connection.query('select mileage from public.vehicles where id=$1', [
    vehicle,
  ])
}
async function waitForLock(pid) {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    if (
      (
        await admin.query(
          'select wait_event_type from pg_stat_activity where pid=$1',
          [pid],
        )
      ).rows[0]?.wait_event_type === 'Lock'
    )
      return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('Competing legacy/service writer did not serialize')
}
function service(connection) {
  return connection.query(
    `select public.save_service_visit($1,null,jsonb_build_object(
    'service_date',(current_date-1)::text,'mileage',30000,'service_type','diy',
    'operations',jsonb_build_array(jsonb_build_object('maintenance_item_id',$2::text,'operation_name','Fictional race completion','next_interval_km',6000))))`,
    [vehicle, schedule],
  )
}
function legacy(connection) {
  return connection.query(
    `update public.vehicle_maintenance_items set name='Fictional legacy race',interval_km=10000,enabled=true,
    history_status='known',last_completed_date=current_date-30,last_completed_mileage=20000 where id=$1 and vehicle_id=$2`,
    [schedule, vehicle],
  )
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
  await admin.query('insert into app_private.app_users(id) values($1)', [owner])
  await admin.query(
    'insert into app_private.firebase_identities(firebase_uid,owner_id) values($1,$2)',
    [uid, owner],
  )
  await admin.query(
    'insert into app_private.firebase_provisioning_approvals(firebase_uid) values($1)',
    [uid],
  )
  await admin.query(
    "insert into public.vehicles(id,owner_id,type,make,model,year,engine,mileage) values($1,$2,'car','Fictional','Legacy race',2020,'Example',50000)",
    [vehicle, owner],
  )
  await admin.query(
    "insert into public.vehicle_maintenance_items(id,vehicle_id,name,interval_km,history_status,last_completed_date,last_completed_mileage) values($1,$2,'Fictional legacy race',10000,'known',current_date-30,10000)",
    [schedule, vehicle],
  )
  const secondPid = (await second.query('select pg_backend_pid() pid')).rows[0]
    .pid
  for (const isolation of [
    'read committed',
    'repeatable read',
    'serializable',
  ]) {
    for (const serviceFirst of [true, false]) {
      await admin.query(
        'delete from public.service_visits where vehicle_id=$1',
        [vehicle],
      )
      await admin.query(
        'update public.vehicle_maintenance_items set last_completed_mileage=10000 where id=$1',
        [schedule],
      )
      await begin(first, isolation)
      await begin(second, isolation)
      await (serviceFirst ? service(first) : legacy(first))
      const pending = (serviceFirst ? legacy(second) : service(second)).then(
        () => null,
        (error) => error,
      )
      await waitForLock(secondPid)
      await first.query('commit')
      const failure = await pending
      if (serviceFirst || isolation !== 'read committed') {
        assert.equal(
          failure?.code,
          isolation === 'read committed' ? '23514' : '40001',
        )
        if (isolation === 'read committed')
          assert.equal(
            failure.constraint,
            'maintenance_completion_source_conflict',
          )
        await second.query('rollback')
        if (!serviceFirst) {
          await begin(second, 'read committed')
          await service(second)
          await second.query('commit')
        }
      } else {
        assert.equal(failure, null)
        await second.query('commit')
      }
      const state = (
        await admin.query(
          `select m.last_completed_mileage,m.interval_km,
        (select count(*) from public.service_visits where vehicle_id=$2) as visits,
        (select next_interval_km from public.service_operations where maintenance_item_id=$1) as override_km
        from public.vehicle_maintenance_items m where m.id=$1`,
          [schedule, vehicle],
        )
      ).rows[0]
      assert.equal(state.last_completed_mileage, serviceFirst ? 10000 : 20000)
      assert.equal(state.interval_km, 10000)
      assert.equal(state.visits, '1')
      assert.equal(state.override_km, 6000)
    }
  }
  console.log(
    'PASS: six legacy-completion/service-link races serialize both write orders without dual writers, deadlocks or partial visits',
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
