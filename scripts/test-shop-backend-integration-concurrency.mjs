// Task 7.9A boundaries only. Requires a fresh disposable local test database.
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
  throw new Error('Integration races require the disposable local database')
const pool = new pg.Pool({ max: 3, statement_timeout: 10000 })
const admin = await pool.connect(),
  a = await pool.connect(),
  b = await pool.connect()
const users = Array.from({ length: 3 }, () => randomUUID()),
  uids = users.map((id) => `fictional-integration-race-${id}`)
const shop = randomUUID(),
  vehicle = randomUUID(),
  visit = randomUUID(),
  grant = randomUUID()
let previousProject
const settle = (promise) =>
  promise.then(
    (value) => ({ value }),
    (error) => ({ error }),
  )
async function begin(connection, isolation = 'read committed', actor = 1) {
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
async function waitForLock(connection) {
  const until = Date.now() + 5000
  while (Date.now() < until) {
    if (
      (
        await admin.query(
          'select wait_event_type from pg_stat_activity where pid=$1',
          [connection.processID],
        )
      ).rows[0]?.wait_event_type === 'Lock'
    )
      return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('Expected integration synchronization lock was not observed')
}
const read = (c) =>
  c.query('select public.get_repair_shop_vehicle($1,$2) data', [shop, vehicle])
const withdraw = (c) =>
  c.query(
    "select public.set_vehicle_shop_data_sharing($1,$2,null,false,'{}')",
    [vehicle, grant],
  )
const privacy = (c) =>
  c.query('select public.set_service_visit_transfer_privacy($1,$2,true)', [
    vehicle,
    visit,
  ])
const accept = (c) =>
  c.query("select public.review_owner_shop_request($1,$2,'accepted')", [
    vehicle,
    grant,
  ])
const cancel = (c) =>
  c.query("select public.resolve_vehicle_shop_request($1,$2,'cancelled')", [
    vehicle,
    grant,
  ])
async function fixture(approved = true) {
  await admin.query(
    "update app_private.repair_shops set suspended=false,subscription_ends_at=clock_timestamp()+interval '1 day' where id=$1",
    [shop],
  )
  await admin.query(
    'update public.service_visits set private_on_transfer=false where id=$1',
    [visit],
  )
  await admin.query(
    "update app_private.vehicle_shop_authorizations set status=$2,shop_accepted_at=null,approved_by=$3,approved_at=$4,share_operation_names=true,customer_display_reference='Fictional alias',resolved_at=null,expires_at=clock_timestamp()+interval '1 day' where id=$1",
    [
      grant,
      approved ? 'approved' : 'pending',
      approved ? users[0] : null,
      approved ? new Date() : null,
    ],
  )
  await admin.query(
    'insert into app_private.shop_service_record_shares(authorization_id,visit_id) values($1,$2) on conflict do nothing',
    [grant, visit],
  )
}
try {
  previousProject = (
    await admin.query('select project_id from app_private.firebase_config')
  ).rows[0].project_id
  await admin.query(
    "update app_private.firebase_config set project_id='fictional-project'",
  )
  for (let n = 0; n < users.length; n++) {
    await admin.query('insert into app_private.app_users(id) values($1)', [
      users[n],
    ])
    await admin.query(
      'insert into app_private.firebase_identities(firebase_uid,owner_id) values($1,$2)',
      [uids[n], users[n]],
    )
    await admin.query(
      'insert into app_private.firebase_provisioning_approvals(firebase_uid) values($1)',
      [uids[n]],
    )
  }
  await admin.query(
    'insert into app_private.platform_administrators(user_id,active) values($1,true)',
    [users[2]],
  )
  await admin.query(
    "insert into app_private.repair_shops(id,name,subscription_status,subscription_starts_at,subscription_ends_at) values($1,'Fictional integration shop','active',clock_timestamp()-interval '1 day',clock_timestamp()+interval '1 day')",
    [shop],
  )
  await admin.query(
    "insert into app_private.repair_shop_staff(shop_id,user_id,role,active) values($1,$2,'admin',true)",
    [shop, users[1]],
  )
  await admin.query(
    "insert into public.vehicles(id,owner_id,type,make,model,year,engine,mileage) values($1,$2,'car','Fictional','Integration',2020,'Example',10000)",
    [vehicle, users[0]],
  )
  await admin.query(
    "insert into public.service_visits(id,vehicle_id,service_date,mileage,service_type,notes) values($1,$2,'2026-01-01',1000,'diy','CONSENT CONTROLLED NOTE')",
    [visit, vehicle],
  )
  await admin.query(
    "insert into app_private.vehicle_shop_authorizations(id,shop_id,vehicle_id,ownership_epoch,initiated_by,expires_at) select $1,$2,id,ownership_epoch,'owner',clock_timestamp()+interval '1 day' from public.vehicles where id=$3",
    [grant, shop, vehicle],
  )
  for (const isolation of [
    'read committed',
    'repeatable read',
    'serializable',
  ]) {
    for (const change of [withdraw, privacy]) {
      for (const readFirst of [true, false]) {
        await fixture()
        await begin(a, isolation, readFirst ? 1 : 0)
        await begin(b, isolation, readFirst ? 0 : 1)
        if (readFirst) {
          assert.ok(
            JSON.stringify((await read(a)).rows).includes(
              'CONSENT CONTROLLED NOTE',
            ),
          )
        } else await change(a)
        const pending = settle(readFirst ? change(b) : read(b))
        await waitForLock(b)
        await a.query('commit')
        const result = await pending
        if (result.error) assert.equal(result.error.code, '40001')
        else if (!readFirst)
          assert.ok(
            !JSON.stringify(result.value.rows).includes(
              'CONSENT CONTROLLED NOTE',
            ),
            'Rich read ignored committed withdrawal/privacy',
          )
        await b.query(result.error ? 'rollback' : 'commit')
      }
    }
    for (const acceptFirst of [true, false]) {
      await fixture(false)
      await begin(a, isolation, acceptFirst ? 1 : 0)
      await begin(b, isolation, acceptFirst ? 0 : 1)
      if (acceptFirst) await accept(a)
      else await cancel(a)
      const pending = settle(acceptFirst ? cancel(b) : accept(b))
      await waitForLock(b)
      await a.query('commit')
      const result = await pending
      if (result.error)
        assert.ok(
          (acceptFirst ? ['40001'] : ['40001', '42501']).includes(
            result.error.code,
          ),
        )
      else assert.ok(acceptFirst, 'Cancelled request accepted')
      await b.query(result.error ? 'rollback' : 'commit')
      const row = (
        await admin.query(
          'select status,approved_by from app_private.vehicle_shop_authorizations where id=$1',
          [grant],
        )
      ).rows[0]
      assert.notEqual(row.status, 'approved')
      assert.equal(row.approved_by, null)
    }
    // New review endpoint must recheck entitlement after a shop-lock wait.
    await fixture(false)
    await begin(a, isolation, 2)
    await a.query(
      "select public.platform_set_shop_suspension($1,true,'Fictional race')",
      [shop],
    )
    await begin(b, isolation, 1)
    const pending = settle(accept(b))
    await waitForLock(b)
    await a.query('commit')
    assert.ok(['42501', '40001'].includes((await pending).error?.code))
    await b.query('rollback')
  }
  console.log(
    'Task 7.9A concurrency PASS: rich read vs consent/privacy, acceptance vs cancellation and suspension at all 3 isolation levels',
  )
} finally {
  await a.query('rollback').catch(() => {})
  await b.query('rollback').catch(() => {})
  await admin.query('delete from public.vehicles where id=$1', [vehicle])
  await admin.query(
    'delete from app_private.repair_shop_staff where shop_id=$1',
    [shop],
  )
  await admin.query(
    'delete from app_private.platform_shop_audit where shop_id=$1',
    [shop],
  )
  await admin.query('delete from app_private.repair_shops where id=$1', [shop])
  await admin.query(
    'delete from app_private.platform_administrators where user_id=any($1)',
    [users],
  )
  await admin.query(
    'delete from app_private.firebase_provisioning_approvals where firebase_uid=any($1)',
    [uids],
  )
  await admin.query(
    'delete from app_private.firebase_identities where firebase_uid=any($1)',
    [uids],
  )
  await admin.query('delete from app_private.app_users where id=any($1)', [
    users,
  ])
  if (previousProject !== undefined)
    await admin.query('update app_private.firebase_config set project_id=$1', [
      previousProject,
    ])
  a.release()
  b.release()
  admin.release()
  await pool.end()
}
