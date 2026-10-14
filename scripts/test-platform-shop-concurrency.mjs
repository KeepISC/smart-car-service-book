// Task 7.4 races only: never use a hosted or existing-user database.
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
  throw new Error('Platform shop races require the disposable local database')
const pool = new pg.Pool({ max: 3, statement_timeout: 10000 })
const admin = await pool.connect()
const first = await pool.connect()
const second = await pool.connect()
const users = Array.from({ length: 6 }, () => randomUUID())
const uids = users.map((id) => `fictional-platform-race-${id}`)
const vehicles = [randomUUID(), randomUUID()]
let shop
let requests
let invitation
let previousProject
const payload = {
  service_date: '2026-01-31',
  mileage: 1000,
  operations: [{ operation_name: 'Fictional work' }],
}
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
    const result = await admin.query(
      'select wait_event_type from pg_stat_activity where pid=$1',
      [pid],
    )
    if (result.rows[0]?.wait_event_type === 'Lock') return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('Expected platform synchronization lock was not observed')
}
function subscription(overrides = {}) {
  return JSON.stringify({
    plan_code: 'manual-race',
    status: 'active',
    starts_at: new Date(Date.now() - 86400000).toISOString(),
    ends_at: new Date(Date.now() + 86400000).toISOString(),
    limits: {
      max_active_staff: null,
      max_connected_vehicles: null,
      max_monthly_records: null,
    },
    ...overrides,
  })
}
async function fixture(approved = true, overrides = {}) {
  await admin.query('delete from public.vehicles where id=any($1)', [vehicles])
  await admin.query(
    'delete from app_private.repair_shop_connection_invitations where shop_id=$1',
    [shop],
  )
  await begin(admin, 'read committed', 0)
  await admin.query('select public.platform_set_shop_suspension($1,false,$2)', [
    shop,
    'Fictional reset',
  ])
  await admin.query(
    'select public.platform_set_shop_subscription($1,$2::jsonb,$3)',
    [shop, subscription(overrides), 'Fictional reset'],
  )
  await admin.query('commit')
  await begin(admin, 'read committed', 0)
  await admin.query(
    'select public.platform_set_shop_administrator($1,$2,true,$3)',
    [shop, uids[1], 'Fictional staff restoration'],
  )
  await admin.query('commit')
  for (let i = 0; i < vehicles.length; i++)
    await admin.query(
      "insert into public.vehicles(id,owner_id,type,make,model,year,engine,mileage) values($1,$2,'car','Fictional','Platform race',2020,'Example',2000)",
      [vehicles[i], users[i + 2]],
    )
  requests = []
  for (let i = 0; i < vehicles.length; i++) {
    await begin(admin, 'read committed', i + 2)
    const id = (
      await admin.query(
        'select public.request_vehicle_shop_authorization($1,$2) id',
        [vehicles[i], shop],
      )
    ).rows[0].id
    requests.push(id)
    if (approved)
      await admin.query(
        'select public.approve_vehicle_shop_authorization($1,$2,true)',
        [vehicles[i], id],
      )
    await admin.query('commit')
  }
  await begin(admin, 'read committed', 1)
  invitation = (
    await admin.query(
      'select public.create_repair_shop_connection_invitation($1) invitation',
      [shop],
    )
  ).rows[0].invitation
  await admin.query('commit')
}
const create = (connection, index = 0) =>
  connection.query(
    'select public.create_repair_shop_service_visit($1,$2,$3::jsonb)',
    [shop, vehicles[index], JSON.stringify(payload)],
  )
try {
  previousProject = (
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
  await admin.query(
    'select app_private.set_platform_administrator($1,true,$2)',
    [uids[0], 'Fictional bootstrap'],
  )
  await begin(admin, 'read committed', 0)
  shop = (
    await admin.query(
      'select public.platform_create_repair_shop($1::jsonb,$2) id',
      [
        JSON.stringify({ business_name: 'Fictional platform races' }),
        'Fictional creation',
      ],
    )
  ).rows[0].id
  await admin.query(
    'select public.platform_set_shop_administrator($1,$2,true,$3)',
    [shop, uids[1], 'Fictional shop admin'],
  )
  await admin.query('commit')
  const secondPid = (await second.query('select pg_backend_pid() pid')).rows[0]
    .pid
  let races = 0
  for (const isolation of [
    'read committed',
    'repeatable read',
    'serializable',
  ]) {
    for (const boundary of ['suspend', 'disable', 'expire']) {
      for (const action of ['read', 'create', 'request', 'preview']) {
        await fixture()
        await begin(first, isolation, 0)
        await begin(
          second,
          isolation,
          action === 'request' || action === 'preview' ? 2 : 1,
        )
        if (boundary === 'suspend')
          await first.query(
            'select public.platform_set_shop_suspension($1,true,$2)',
            [shop, 'Fictional suspension'],
          )
        else
          await first.query(
            'select public.platform_set_shop_subscription($1,$2::jsonb,$3)',
            [
              shop,
              subscription(
                boundary === 'disable'
                  ? { status: 'disabled' }
                  : { ends_at: new Date(Date.now() - 1000).toISOString() },
              ),
              'Fictional boundary',
            ],
          )
        const pending = settle(
          action === 'read'
            ? second.query('select public.get_repair_shop_vehicle($1,$2)', [
                shop,
                vehicles[0],
              ])
            : action === 'create'
              ? create(second)
              : action === 'request'
                ? second.query(
                    'select public.request_vehicle_shop_authorization($1,$2)',
                    [vehicles[0], shop],
                  )
                : second.query(
                    'select public.preview_repair_shop_connection_invitation($1)',
                    [invitation.token],
                  ),
        )
        await observeLock(secondPid)
        await first.query('commit')
        assert.equal(
          (await pending).error?.code,
          isolation === 'read committed' ? '42501' : '40001',
          `${isolation}: ${boundary} must defeat ${action}`,
        )
        await second.query('rollback')
        assert.equal(
          (
            await admin.query(
              'select count(*)::int count from public.service_visits where vehicle_id=any($1)',
              [vehicles],
            )
          ).rows[0].count,
          0,
        )
        races++
      }
    }
    // Authorized creation finishes first; suspension waits and keeps its history.
    await fixture()
    await begin(first, isolation, 1)
    await begin(second, isolation, 0)
    await create(first)
    const suspend = settle(
      second.query('select public.platform_set_shop_suspension($1,true,$2)', [
        shop,
        'Fictional reverse suspension',
      ]),
    )
    await observeLock(secondPid)
    await first.query('commit')
    const suspended = await suspend
    if (suspended.error) {
      assert.equal(suspended.error.code, '40001')
      await second.query('rollback')
      await begin(second, 'read committed', 0)
      await second.query(
        'select public.platform_set_shop_suspension($1,true,$2)',
        [shop, 'Fictional retry'],
      )
    }
    await second.query('commit')
    assert.equal(
      (
        await admin.query(
          'select count(*)::int count from public.service_visits where vehicle_id=any($1)',
          [vehicles],
        )
      ).rows[0].count,
      1,
    )
    races++
    // Capacity decisions serialize on shop versions across different vehicles.
    for (const kind of ['records', 'connections', 'invitations']) {
      await fixture(kind === 'records', {
        limits: {
          max_active_staff: null,
          max_connected_vehicles: kind === 'records' ? null : 1,
          max_monthly_records: kind === 'records' ? 1 : null,
        },
      })
      let otherInvitation
      if (kind === 'invitations') {
        await begin(admin, 'read committed', 1)
        otherInvitation = (
          await admin.query(
            'select public.create_repair_shop_connection_invitation($1) invitation',
            [shop],
          )
        ).rows[0].invitation
        await admin.query('commit')
      }
      await begin(first, isolation, kind === 'records' ? 1 : 2)
      await begin(second, isolation, kind === 'records' ? 1 : 3)
      const allocate = (connection, index) =>
        kind === 'records'
          ? create(connection, index)
          : kind === 'connections'
            ? connection.query(
                'select public.approve_vehicle_shop_authorization($1,$2,true)',
                [vehicles[index], requests[index]],
              )
            : connection.query(
                'select public.accept_repair_shop_connection_invitation($1,$2,true)',
                [
                  index === 0 ? invitation.token : otherInvitation.token,
                  vehicles[index],
                ],
              )
      await allocate(first, 0)
      const pending = settle(allocate(second, 1))
      await observeLock(secondPid)
      await first.query('commit')
      assert.equal(
        (await pending).error?.code,
        isolation === 'read committed' ? '23514' : '40001',
        `${isolation}: ${kind} must not exceed capacity`,
      )
      await second.query('rollback')
      const result = await admin.query(
        kind === 'records'
          ? 'select count(*)::int count from app_private.repair_shop_service_records where shop_id=$1'
          : "select count(*)::int count from app_private.vehicle_shop_authorizations where shop_id=$1 and status='approved'",
        [shop],
      )
      assert.equal(result.rows[0].count, 1)
      races++
    }
    // Platform removal advances the shop version just like ordinary staff removal.
    for (const action of ['read', 'create', 'preview']) {
      await fixture()
      await begin(first, isolation, 0)
      await begin(second, isolation, action === 'preview' ? 2 : 1)
      await first.query(
        'select public.platform_set_shop_administrator($1,$2,false,$3)',
        [shop, uids[1], 'Fictional shop admin revocation'],
      )
      const pending = settle(
        action === 'read'
          ? second.query('select public.get_repair_shop_vehicle($1,$2)', [
              shop,
              vehicles[0],
            ])
          : action === 'create'
            ? create(second)
            : second.query(
                'select public.preview_repair_shop_connection_invitation($1)',
                [invitation.token],
              ),
      )
      await observeLock(secondPid)
      await first.query('commit')
      assert.equal(
        (await pending).error?.code,
        isolation === 'read committed' ? '42501' : '40001',
        `${isolation}: platform staff removal must deny ${action}`,
      )
      await second.query('rollback')
      races++
    }
    await fixture(true, {
      limits: {
        max_active_staff: 2,
        max_connected_vehicles: null,
        max_monthly_records: null,
      },
    })
    await admin.query(
      'delete from app_private.repair_shop_staff where shop_id=$1 and user_id=any($2)',
      [shop, [users[4], users[5]]],
    )
    await begin(first, isolation, 0)
    await begin(second, isolation, 0)
    await first.query(
      'select public.platform_set_shop_administrator($1,$2,true,$3)',
      [shop, uids[4], 'Fictional capacity assignment'],
    )
    const assignment = settle(
      second.query(
        'select public.platform_set_shop_administrator($1,$2,true,$3)',
        [shop, uids[5], 'Fictional concurrent assignment'],
      ),
    )
    await observeLock(secondPid)
    await first.query('commit')
    assert.equal(
      (await assignment).error?.code,
      isolation === 'read committed' ? '23514' : '40001',
    )
    await second.query('rollback')
    assert.equal(
      (
        await admin.query(
          'select count(*)::int count from app_private.repair_shop_staff where shop_id=$1 and active',
          [shop],
        )
      ).rows[0].count,
      2,
    )
    races++
    // Revoke platform authority first; a stale admin cannot modify shop metadata.
    await fixture()
    await begin(first, isolation, 0)
    await first.query('reset role')
    await first.query(
      'select app_private.set_platform_administrator($1,false,$2)',
      [uids[0], 'Fictional revocation'],
    )
    await begin(second, isolation, 0)
    const mutation = settle(
      second.query('select public.platform_set_shop_suspension($1,true,$2)', [
        shop,
        'Stale platform action',
      ]),
    )
    await observeLock(secondPid)
    await first.query('commit')
    assert.equal(
      (await mutation).error?.code,
      isolation === 'read committed' ? '42501' : '40001',
    )
    await second.query('rollback')
    await admin.query(
      'select app_private.set_platform_administrator($1,true,$2)',
      [uids[0], 'Fictional restoration'],
    )
    races++
  }
  // Expiry during a schedule lock wait must roll back a started service creation.
  await fixture()
  const item = randomUUID()
  await admin.query(
    "insert into public.vehicle_maintenance_items(id,vehicle_id,name,interval_km) values($1,$2,'Fictional schedule',10000)",
    [item, vehicles[0]],
  )
  await admin.query(
    "update app_private.repair_shops set subscription_ends_at=clock_timestamp()+interval '350 milliseconds' where id=$1",
    [shop],
  )
  await first.query('begin')
  await first.query(
    'select id from public.vehicle_maintenance_items where id=$1 for update',
    [item],
  )
  await begin(second, 'read committed', 1)
  const record = settle(
    second.query(
      'select public.create_repair_shop_service_visit($1,$2,$3::jsonb)',
      [
        shop,
        vehicles[0],
        JSON.stringify({
          ...payload,
          operations: [
            {
              operation_name: 'Fictional delayed work',
              maintenance_item_id: item,
            },
          ],
        }),
      ],
    ),
  )
  await observeLock(secondPid)
  await new Promise((resolve) => setTimeout(resolve, 450))
  await first.query('commit')
  assert.equal((await record).error?.code, '42501')
  await second.query('rollback')
  assert.equal(
    (
      await admin.query(
        'select count(*)::int count from public.service_visits where vehicle_id=$1',
        [vehicles[0]],
      )
    ).rows[0].count,
    0,
  )
  races++
  console.log(
    `PASS: ${races} platform suspension/subscription, capacity, role revocation and post-wait expiry races`,
  )
} finally {
  for (const connection of [first, second, admin])
    await connection.query('rollback')
  await admin.query('delete from public.vehicles where id=any($1)', [vehicles])
  if (shop) {
    await admin.query(
      'delete from app_private.platform_shop_audit where shop_id=$1',
      [shop],
    )
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
    "delete from app_private.platform_shop_audit where actor_id=any($1) or (shop_id is null and after_state->>'user_id'=any($2))",
    [users, users],
  )
  await admin.query(
    'delete from app_private.platform_administrators where user_id=any($1)',
    [users],
  )
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
  if (previousProject)
    await admin.query('update app_private.firebase_config set project_id=$1', [
      previousProject,
    ])
  for (const connection of [first, second, admin]) connection.release()
  await pool.end()
}
