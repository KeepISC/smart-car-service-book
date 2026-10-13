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
    'Service-history concurrency tests require the disposable local database.',
  )
}

const pool = new pg.Pool({
  max: 3,
  connectionTimeoutMillis: 5000,
  statement_timeout: 15000,
})
const owner = randomUUID()
const vehicle = randomUUID()
const uid = `fictional-service-${owner}`
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
  throw new Error(
    'Competing service/odometer write did not wait for the vehicle lock',
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
    "insert into public.vehicles(id,owner_id,type,make,model,year,engine,mileage) values ($1,$2,'car','Fictional','Service concurrency',2020,'Example',20000)",
    [vehicle, owner],
  )
  const secondPid = (await second.query('select pg_backend_pid() as pid'))
    .rows[0].pid

  for (const editing of [false, true]) {
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
          'update public.vehicles set mileage=20000 where id=$1',
          [vehicle],
        )
        let visitId = null
        if (editing) {
          visitId = (
            await admin.query(
              `insert into public.service_visits(vehicle_id,service_date,mileage,service_type)
           values ($1,current_date-2,5000,'diy') returning id`,
              [vehicle],
            )
          ).rows[0].id
          await admin.query(
            "insert into public.service_operations(service_visit_id,operation_name) values ($1,'Fictional original operation')",
            [visitId],
          )
        }
        await begin(first, isolation)
        await begin(second, isolation)

        const serviceWrite = (connection) =>
          connection.query(
            `select public.save_service_visit(
            $1, $2,
            jsonb_build_object(
              'service_date', (current_date - 1)::text,
              'mileage', 18000,
              'service_type', 'diy',
              'workshop_name', null,
              'total_cost', null,
              'notes', null,
              'operations', jsonb_build_array(jsonb_build_object(
                'maintenance_item_id', null,
                'operation_name', 'Fictional concurrent operation',
                'cost', null,
                'next_interval_km', null,
                'next_interval_months', null
              ))
            )
          )`,
            [vehicle, visitId],
          )
        const mileageWrite = (connection) =>
          connection.query(
            'update public.vehicles set mileage=10000 where id=$1',
            [vehicle],
          )

        await (serviceFirst ? serviceWrite(first) : mileageWrite(first))
        const pending = (
          serviceFirst ? mileageWrite(second) : serviceWrite(second)
        ).then(
          () => null,
          (error) => error,
        )
        await waitForLock(secondPid)
        await first.query('commit')
        const failure = await pending
        assert.ok(
          failure,
          'Both incompatible service/odometer writes committed',
        )
        assert.equal(
          failure.code,
          isolation === 'read committed' ? '23514' : '40001',
        )
        await second.query('rollback')
        const result = await admin.query(
          `select v.mileage, max(sv.mileage) as service_mileage
         from public.vehicles v
         left join public.service_visits sv on sv.vehicle_id=v.id
         where v.id=$1 group by v.id`,
          [vehicle],
        )
        assert.ok(
          result.rows[0].service_mileage === null ||
            result.rows[0].mileage >= result.rows[0].service_mileage,
        )
      }
    }
  }
  console.log(
    'PASS: 12 authenticated concurrent service insert/edit/odometer races, both write orders, all three isolation levels.',
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
