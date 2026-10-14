// Task 7.2 connection races only; fictional fixtures in guarded local PostgreSQL.
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
  throw new Error('Connection tests require the disposable local database')

const pool = new pg.Pool({ max: 3, statement_timeout: 10000 })
const admin = await pool.connect()
const first = await pool.connect()
const second = await pool.connect()
const users = Array.from({ length: 3 }, () => randomUUID())
const uids = users.map((id) => `fictional-connection-race-${id}`)
const vehicles = [randomUUID(), randomUUID()]
let shop
let invitation
let originalProject
const settle = (promise) =>
  promise.then(
    (value) => ({ value }),
    (error) => ({ error }),
  )
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
async function observeLock(pid) {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    const { rows } = await admin.query(
      'select wait_event_type from pg_stat_activity where pid=$1',
      [pid],
    )
    if (rows[0]?.wait_event_type === 'Lock') return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('Expected connection lock was not observed')
}
async function fixture() {
  await admin.query('delete from public.vehicles where id=any($1)', [vehicles])
  await admin.query(
    'delete from app_private.repair_shop_connection_invitations where shop_id=$1',
    [shop],
  )
  for (const vehicle of vehicles)
    await admin.query(
      "insert into public.vehicles(id,owner_id,type,make,model,year,engine,mileage) values($1,$2,'car','Fictional','Connection race',2020,'Example',2000)",
      [vehicle, users[0]],
    )
  await begin(admin, 'read committed', 2)
  await admin.query("select public.set_repair_shop_staff($1,$2,'admin')", [
    shop,
    users[1],
  ])
  await admin.query('commit')
  await begin(admin, 'read committed', 1)
  invitation = (
    await admin.query(
      'select public.create_repair_shop_connection_invitation($1) invitation',
      [shop],
    )
  ).rows[0].invitation
  await admin.query('commit')
}
const accept = (connection, vehicle = vehicles[0]) =>
  connection.query(
    'select public.accept_repair_shop_connection_invitation($1,$2,true)',
    [invitation.token, vehicle],
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
  await begin(admin, 'read committed', 2)
  shop = (
    await admin.query(
      "select public.create_repair_shop('Fictional connection races') id",
    )
  ).rows[0].id
  await admin.query('commit')
  await begin(admin, 'read committed', 1)
  await admin.query('select public.request_repair_shop_membership($1)', [shop])
  await admin.query('commit')
  const secondPid = (await second.query('select pg_backend_pid() pid')).rows[0]
    .pid
  let races = 0
  for (const isolation of [
    'read committed',
    'repeatable read',
    'serializable',
  ]) {
    for (const boundary of [
      'accept-other-vehicle',
      'cancel',
      'decline',
      'remove',
      'transfer',
    ]) {
      await fixture()
      let transferToken
      if (boundary === 'transfer') {
        await begin(admin, 'read committed', 0)
        transferToken = (
          await admin.query(
            'select public.create_vehicle_transfer($1) invitation',
            [vehicles[0]],
          )
        ).rows[0].invitation.token
        await admin.query('commit')
      }
      await begin(
        first,
        isolation,
        boundary === 'accept-other-vehicle' || boundary === 'decline' ? 0 : 2,
      )
      await begin(second, isolation, 0)
      if (boundary === 'accept-other-vehicle') await accept(first, vehicles[1])
      else if (boundary === 'cancel')
        await first.query(
          'select public.cancel_repair_shop_connection_invitation($1,$2)',
          [shop, invitation.id],
        )
      else if (boundary === 'decline')
        await first.query(
          'select public.decline_repair_shop_connection_invitation($1)',
          [invitation.token],
        )
      else if (boundary === 'remove')
        await first.query('select public.set_repair_shop_staff($1,$2,null)', [
          shop,
          users[1],
        ])
      else
        await first.query('select public.accept_vehicle_transfer($1)', [
          transferToken,
        ])
      const pending = settle(accept(second))
      await observeLock(secondPid)
      await first.query('commit')
      const result = await pending
      assert.equal(
        result.error?.code,
        isolation === 'read committed' ? '42501' : '40001',
        `${isolation}: ${boundary} must defeat stale acceptance`,
      )
      await second.query('rollback')
      const count = (
        await admin.query(
          "select count(*)::int count from app_private.vehicle_shop_authorizations where vehicle_id=$1 and status='approved'",
          [vehicles[0]],
        )
      ).rows[0].count
      assert.equal(count, 0)
      races++
    }
    // Acceptance first consumes the link; a racing cancellation cannot undo approval.
    await fixture()
    await begin(first, isolation, 0)
    await begin(second, isolation, 2)
    await accept(first)
    const cancellation = settle(
      second.query(
        'select public.cancel_repair_shop_connection_invitation($1,$2)',
        [shop, invitation.id],
      ),
    )
    await observeLock(secondPid)
    await first.query('commit')
    const cancelResult = await cancellation
    assert.equal(
      cancelResult.error?.code,
      isolation === 'read committed' ? '42501' : '40001',
    )
    await second.query('rollback')
    assert.equal(
      (
        await admin.query(
          "select count(*)::int count from app_private.vehicle_shop_authorizations where vehicle_id=$1 and status='approved'",
          [vehicles[0]],
        )
      ).rows[0].count,
      1,
    )
    races++
    // Pending cancellation beats owner approval at the vehicle row-version boundary.
    await fixture()
    await begin(admin, 'read committed', 0)
    const requestId = (
      await admin.query(
        'select public.request_vehicle_shop_authorization($1,$2) id',
        [vehicles[0], shop],
      )
    ).rows[0].id
    await admin.query('commit')
    await begin(first, isolation, 0)
    await begin(second, isolation, 0)
    await first.query(
      "select public.resolve_vehicle_shop_request($1,$2,'cancelled')",
      [vehicles[0], requestId],
    )
    const approval = settle(
      second.query(
        'select public.approve_vehicle_shop_authorization($1,$2,true)',
        [vehicles[0], requestId],
      ),
    )
    await observeLock(secondPid)
    await first.query('commit')
    const approvalResult = await approval
    assert.equal(
      approvalResult.error?.code,
      isolation === 'read committed' ? '42501' : '40001',
    )
    await second.query('rollback')
    races++
  }
  // Expiry is evaluated after lock waits, not at the initial transaction snapshot.
  await fixture()
  await admin.query(
    "update app_private.repair_shop_connection_invitations set expires_at=clock_timestamp()+interval '350 milliseconds' where id=$1",
    [invitation.id],
  )
  await begin(first, 'read committed', 0)
  await first.query('select id from public.vehicles where id=$1 for update', [
    vehicles[0],
  ])
  await begin(second, 'read committed', 0)
  const pending = settle(accept(second))
  await observeLock(secondPid)
  await new Promise((resolve) => setTimeout(resolve, 450))
  await first.query('commit')
  assert.equal((await pending).error?.code, '42501')
  await second.query('rollback')
  races++
  for (const isolation of [
    'read committed',
    'repeatable read',
    'serializable',
  ]) {
    await fixture()
    await begin(admin, 'read committed', 0)
    const requestId = (
      await admin.query(
        'select public.request_vehicle_shop_authorization($1,$2) id',
        [vehicles[0], shop],
      )
    ).rows[0].id
    await admin.query('commit')
    await admin.query(
      "update app_private.vehicle_shop_authorizations set expires_at=clock_timestamp()+interval '350 milliseconds' where id=$1",
      [requestId],
    )
    await begin(first, isolation, 0)
    await first.query('select id from public.vehicles where id=$1 for update', [
      vehicles[0],
    ])
    await begin(second, isolation, 0)
    const approval = settle(
      second.query(
        'select public.approve_vehicle_shop_authorization($1,$2,true)',
        [vehicles[0], requestId],
      ),
    )
    await observeLock(secondPid)
    await new Promise((resolve) => setTimeout(resolve, 450))
    await first.query('commit')
    assert.equal(
      (await approval).error?.code,
      '42501',
      `${isolation}: pending approval must recheck expiry after waiting`,
    )
    await second.query('rollback')
    races++
  }
  console.log(
    `PASS: ${races} connection replay, cancellation, decline, issuer removal, transfer, approval and post-wait expiry races`,
  )
} finally {
  for (const connection of [first, second, admin])
    await connection.query('rollback')
  await admin.query('delete from public.vehicles where id=any($1)', [vehicles])
  if (shop) {
    await admin.query(
      'delete from app_private.repair_shop_connection_invitations where shop_id=$1',
      [shop],
    )
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
