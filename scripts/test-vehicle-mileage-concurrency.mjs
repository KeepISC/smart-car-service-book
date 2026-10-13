// Fictional fixtures in a disposable local database only.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import pg from 'pg'

if (
  process.env.SCSB_DISPOSABLE_DATABASE_TEST !== 'true' ||
  process.env.PGHOST !== 'localhost' ||
  process.env.PGDATABASE !== 'maintenance_test' ||
  process.env.PGUSER !== 'postgres' ||
  process.env.PGPORT !== '5432'
)
  throw new Error(
    'Mileage concurrency tests require the disposable local database.',
  )

const pool = new pg.Pool({
  max: 3,
  connectionTimeoutMillis: 5000,
  statement_timeout: 15000,
})
const admin = await pool.connect()
const first = await pool.connect()
const second = await pool.connect()
const owner = randomUUID()
const vehicle = randomUUID()
const uid = `fictional-mileage-${owner}`
let previousProject
const claims = JSON.stringify({
  iss: 'https://securetoken.google.com/fictional-project',
  aud: 'fictional-project',
  sub: uid,
  role: 'authenticated',
  email_verified: true,
  app_owner_id: owner,
})
async function begin(connection, isolation) {
  await connection.query(`begin isolation level ${isolation}`)
  await connection.query('select set_config($1,$2,true)', [
    'request.jwt.claims',
    claims,
  ])
  await connection.query('set local role authenticated')
  await connection.query('select mileage from public.vehicles where id=$1', [
    vehicle,
  ])
}
const updateMileage = (connection, mileage) =>
  connection.query(
    'select (public.update_vehicle_mileage($1,$2)).mileage as mileage',
    [vehicle, mileage],
  )
async function waitForLock(pid) {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    const { rows } = await admin.query(
      'select wait_event_type from pg_stat_activity where pid=$1',
      [pid],
    )
    if (rows[0]?.wait_event_type === 'Lock') return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('Competing mileage update did not wait for the vehicle lock')
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
    "insert into public.vehicles(id,owner_id,type,make,model,year,engine,mileage) values ($1,$2,'car','Fictional','Mileage race',2020,'Example',10000)",
    [vehicle, owner],
  )
  const pid = (await second.query('select pg_backend_pid() as pid')).rows[0].pid
  for (const isolation of [
    'read committed',
    'repeatable read',
    'serializable',
  ]) {
    for (const highFirst of [false, true]) {
      await admin.query(
        'update public.vehicles set mileage=10000 where id=$1',
        [vehicle],
      )
      await admin.query(
        'delete from public.vehicle_mileage_history where vehicle_id=$1',
        [vehicle],
      )
      await begin(first, isolation)
      await begin(second, isolation)
      await updateMileage(first, highFirst ? 13000 : 12000)
      // A concurrent metadata edit must never be overwritten by a mileage RPC.
      await first.query(
        "update public.vehicles set model='Edited concurrently' where id=$1",
        [vehicle],
      )
      const pending = updateMileage(second, highFirst ? 12000 : 13000).then(
        () => ({ code: null }),
        (error) => ({ code: error.code }),
      )
      await waitForLock(pid)
      await first.query('commit')
      const result = await pending
      const expectedCode =
        isolation !== 'read committed' ? '40001' : highFirst ? '23514' : null
      assert.equal(result.code, expectedCode)
      await second.query(result.code ? 'rollback' : 'commit')
      const history = (
        await admin.query(
          'select mileage,source from public.vehicle_mileage_history where vehicle_id=$1 order by recorded_at,id',
          [vehicle],
        )
      ).rows
      assert.deepEqual(
        history,
        (result.code ? [highFirst ? 13000 : 12000] : [12000, 13000]).map(
          (mileage) => ({ mileage, source: 'manual' }),
        ),
      )
      const saved = (
        await admin.query(
          'select mileage,model from public.vehicles where id=$1',
          [vehicle],
        )
      ).rows[0]
      assert.equal(saved.mileage, history.at(-1).mileage)
      assert.equal(saved.model, 'Edited concurrently')
    }
  }
  console.log(
    'PASS: 6 mileage races across READ COMMITTED, REPEATABLE READ and SERIALIZABLE; atomic history, stale decreases rejected, metadata preserved',
  )
} finally {
  await first.query('rollback').catch(() => {})
  await second.query('rollback').catch(() => {})
  await admin.query('delete from app_private.app_users where id=$1', [owner])
  await admin.query(
    'delete from app_private.firebase_provisioning_approvals where firebase_uid=$1',
    [uid],
  )
  if (previousProject)
    await admin.query(
      'update app_private.firebase_config set project_id=$1 where singleton',
      [previousProject],
    )
  first.release()
  second.release()
  admin.release()
  await pool.end()
}
