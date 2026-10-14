// Fictional data only. Never connect this mutating test to a hosted database.
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
  throw new Error('Shop races require the disposable local database')

const pool = new pg.Pool({ max: 3, statement_timeout: 10000 })
const admin = await pool.connect()
const first = await pool.connect()
const second = await pool.connect()
const users = Array.from({ length: 4 }, () => randomUUID())
const uids = users.map((id) => `fictional-shop-race-${id}`)
const vehicle = randomUUID()
let shop
let authorization
let token
let originalProject
const payload = {
  service_date: '2026-01-31',
  mileage: 1000,
  operations: [{ operation_name: 'Fictional work' }],
}

async function begin(connection, isolation, actor) {
  await connection.query(`begin isolation level ${isolation}`)
  await connection.query('select set_config($1,$2,true)', [
    'request.jwt.claims',
    JSON.stringify({
      iss: 'https://securetoken.google.com/fictional-project',
      aud: 'fictional-project',
      sub: uids[actor],
      role: 'authenticated',
      email_verified: true,
      app_owner_id: users[actor],
    }),
  ])
  await connection.query('set local role authenticated')
  await connection.query('select count(*) from public.vehicles')
}
async function backendPid(connection) {
  const pid = (await connection.query('select pg_backend_pid() pid')).rows[0]
    .pid
  return pid
}
async function observeLock(pid) {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    const result = await admin.query(
      'select wait_event_type from pg_stat_activity where pid=$1',
      [pid],
    )
    if (result.rows[0]?.wait_event_type === 'Lock') return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('Expected shop synchronization lock was not observed')
}
async function fixture() {
  await admin.query('delete from public.vehicles where id=$1', [vehicle])
  await admin.query(
    "insert into public.vehicles(id,owner_id,type,make,model,year,engine,mileage) values($1,$2,'car','Fictional','Shop race',2020,'Example',2000)",
    [vehicle, users[0]],
  )
  await begin(admin, 'read committed', 1)
  await admin.query("select public.set_repair_shop_staff($1,$2,'mechanic')", [
    shop,
    users[2],
  ])
  await admin.query('commit')
  await begin(admin, 'read committed', 0)
  authorization = (
    await admin.query(
      'select public.request_vehicle_shop_authorization($1,$2) id',
      [vehicle, shop],
    )
  ).rows[0].id
  await admin.query(
    'select public.approve_vehicle_shop_authorization($1,$2,true)',
    [vehicle, authorization],
  )
  token = (
    await admin.query('select public.create_vehicle_transfer($1) invitation', [
      vehicle,
    ])
  ).rows[0].invitation.token
  await admin.query('commit')
}
const boundaries = {
  revoke: {
    actor: 0,
    run: (connection) =>
      connection.query(
        'select public.revoke_vehicle_shop_authorization($1,$2)',
        [vehicle, authorization],
      ),
  },
  remove: {
    actor: 1,
    run: (connection) =>
      connection.query('select public.set_repair_shop_staff($1,$2,null)', [
        shop,
        users[2],
      ]),
  },
  transfer: {
    actor: 3,
    run: (connection) =>
      connection.query('select public.accept_vehicle_transfer($1)', [token]),
  },
}
const customerActions = {
  read: (connection) =>
    connection.query('select public.get_repair_shop_vehicle($1,$2)', [
      shop,
      vehicle,
    ]),
  create: (connection) =>
    connection.query(
      'select public.create_repair_shop_service_visit($1,$2,$3::jsonb)',
      [shop, vehicle, JSON.stringify(payload)],
    ),
}
// Attach an error handler immediately, before coordinating a blocked query.
const settled = (promise) =>
  promise.then(
    (value) => ({ value }),
    (error) => ({ error }),
  )

try {
  originalProject = (
    await admin.query('select project_id from app_private.firebase_config')
  ).rows[0].project_id
  await admin.query(
    "update app_private.firebase_config set project_id='fictional-project'",
  )
  for (let i = 0; i < users.length; i++) {
    await admin.query('insert into app_private.app_users(id) values($1)', [
      users[i],
    ])
    await admin.query(
      'insert into app_private.firebase_identities(firebase_uid,owner_id) values($1,$2)',
      [uids[i], users[i]],
    )
    await admin.query(
      'insert into app_private.firebase_provisioning_approvals(firebase_uid) values($1)',
      [uids[i]],
    )
  }
  await begin(admin, 'read committed', 1)
  shop = (
    await admin.query(
      "select public.create_repair_shop('Fictional race shop') id",
    )
  ).rows[0].id
  await admin.query('commit')
  await begin(admin, 'read committed', 2)
  await admin.query('select public.request_repair_shop_membership($1)', [shop])
  await admin.query('commit')
  const secondPid = await backendPid(second)
  let races = 0
  for (const isolation of [
    'read committed',
    'repeatable read',
    'serializable',
  ]) {
    for (const [boundaryName, boundary] of Object.entries(boundaries)) {
      for (const [actionName, action] of Object.entries(customerActions)) {
        await fixture()
        await begin(first, isolation, boundary.actor)
        await begin(second, isolation, 2)
        await boundary.run(first)
        const pending = settled(action(second))
        await observeLock(secondPid)
        await first.query('commit')
        const result = await pending
        assert.equal(
          result.error?.code,
          isolation === 'read committed' ? '42501' : '40001',
          `${isolation}: ${boundaryName} must deny stale ${actionName}`,
        )
        await second.query('rollback')
        assert.equal(
          (
            await admin.query(
              'select count(*)::int count from public.service_visits where vehicle_id=$1',
              [vehicle],
            )
          ).rows[0].count,
          0,
        )
        races++
      }
      // Reverse ordering: authorized work commits before the revocation boundary.
      await fixture()
      await begin(first, isolation, 2)
      await begin(second, isolation, boundary.actor)
      await customerActions.create(first)
      const pending = settled(boundary.run(second))
      await observeLock(secondPid)
      await first.query('commit')
      const result = await pending
      if (result.error) {
        assert.equal(result.error.code, '40001')
        await second.query('rollback')
        await begin(second, 'read committed', boundary.actor)
        await boundary.run(second)
      }
      await second.query('commit')
      assert.equal(
        (
          await admin.query(
            'select count(*)::int count from public.service_visits where vehicle_id=$1',
            [vehicle],
          )
        ).rows[0].count,
        1,
      )
      races++
    }
    // Two admins cannot concurrently demote each other and leave no admin.
    await begin(admin, 'read committed', 3)
    await admin.query('select public.request_repair_shop_membership($1)', [
      shop,
    ])
    await admin.query('commit')
    await begin(admin, 'read committed', 1)
    await admin.query("select public.set_repair_shop_staff($1,$2,'admin')", [
      shop,
      users[3],
    ])
    await admin.query('commit')
    await begin(first, isolation, 1)
    await begin(second, isolation, 3)
    await first.query("select public.set_repair_shop_staff($1,$2,'mechanic')", [
      shop,
      users[3],
    ])
    const pending = settled(
      second.query("select public.set_repair_shop_staff($1,$2,'mechanic')", [
        shop,
        users[1],
      ]),
    )
    await observeLock(secondPid)
    await first.query('commit')
    const result = await pending
    assert.equal(
      result.error?.code,
      isolation === 'read committed' ? '42501' : '40001',
    )
    await second.query('rollback')
    assert.equal(
      (
        await admin.query(
          "select count(*)::int count from app_private.repair_shop_staff where shop_id=$1 and active and role='admin'",
          [shop],
        )
      ).rows[0].count,
      1,
    )
    races++
  }
  console.log(
    `PASS: ${races} shop revocation, removal, transfer, creation and admin races across three isolation levels`,
  )
} finally {
  for (const connection of [first, second, admin])
    await connection.query('rollback')
  await admin.query('delete from public.vehicles where id=$1', [vehicle])
  if (shop) {
    await admin.query(
      'delete from app_private.repair_shop_staff where shop_id=$1',
      [shop],
    )
    await admin.query('delete from app_private.repair_shops where id=$1', [
      shop,
    ])
  }
  await admin.query(
    'delete from app_private.firebase_identities where firebase_uid=any($1)',
    [uids],
  )
  await admin.query(
    'delete from app_private.firebase_provisioning_approvals where firebase_uid=any($1)',
    [uids],
  )
  await admin.query('delete from app_private.app_users where id=any($1)', [
    users,
  ])
  if (originalProject)
    await admin.query('update app_private.firebase_config set project_id=$1', [
      originalProject,
    ])
  for (const connection of [first, second, admin]) connection.release()
  await pool.end()
}
