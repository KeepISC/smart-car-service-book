// Task 7.8 only; never run against hosted databases or existing user data.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import {
  calculateMaintenance,
  applyServiceHistory,
} from '../src/services/maintenanceLogic.ts'

if (
  process.env.SCSB_DISPOSABLE_DATABASE_TEST !== 'true' ||
  process.env.PGHOST !== 'localhost' ||
  process.env.PGPORT !== '5432' ||
  process.env.PGDATABASE !== 'maintenance_test' ||
  process.env.PGUSER !== 'postgres'
)
  throw new Error('Reminder races require the disposable local database')
const pool = new pg.Pool({ max: 3, statement_timeout: 10000 })
const admin = await pool.connect()
const a = await pool.connect()
const b = await pool.connect()
const users = [randomUUID(), randomUUID(), randomUUID()]
const uids = users.map((id) => `fictional-reminder-race-${id}`)
const shop = randomUUID(),
  vehicle = randomUUID(),
  item = randomUUID(),
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
    const row = await admin.query(
      'select wait_event_type from pg_stat_activity where pid=$1',
      [connection.processID],
    )
    if (row.rows[0]?.wait_event_type === 'Lock') return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('Expected reminder synchronization lock was not observed')
}
const send = (connection) =>
  connection.query('select public.send_shop_maintenance_reminder($1,$2,$3)', [
    shop,
    vehicle,
    item,
  ])
async function fixture() {
  await admin.query(
    'delete from app_private.shop_maintenance_reminders where shop_id=$1',
    [shop],
  )
  await admin.query('update public.vehicles set owner_id=$2 where id=$1', [
    vehicle,
    users[0],
  ])
  await admin.query(
    "update app_private.repair_shops set suspended=false,subscription_ends_at=clock_timestamp()+interval '1 day' where id=$1",
    [shop],
  )
  await admin.query(
    'update app_private.repair_shop_staff set active=true where shop_id=$1',
    [shop],
  )
  await admin.query(
    "update app_private.vehicle_shop_authorizations set status='approved',revoked_at=null,approved_by=$2,ownership_epoch=(select ownership_epoch from public.vehicles where id=$3) where id=$1",
    [grant, users[0], vehicle],
  )
}
const changes = {
  revoke: async (c) => {
    await c.query('reset role')
    await c.query(
      "update app_private.vehicle_shop_authorizations set status='revoked',revoked_at=clock_timestamp() where id=$1",
      [grant],
    )
  },
  transfer: async (c) => {
    await c.query('reset role')
    await c.query(
      'update public.vehicles set owner_id=$2,ownership_epoch=ownership_epoch+1 where id=$1',
      [vehicle, users[2]],
    )
  },
  staff: async (c) => {
    await c.query('reset role')
    await c.query('update app_private.repair_shops set name=name where id=$1', [
      shop,
    ])
    await c.query(
      'update app_private.repair_shop_staff set active=false where shop_id=$1',
      [shop],
    )
  },
  suspension: async (c) => {
    await c.query('reset role')
    await c.query(
      'update app_private.repair_shops set suspended=true where id=$1',
      [shop],
    )
  },
}
// Revocation follows the real vehicle boundary; a privileged fixture update
// alone would not exercise the production lock ordering.
changes.revoke = (c) =>
  c.query('select public.revoke_vehicle_shop_authorization($1,$2)', [
    vehicle,
    grant,
  ])
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
    "insert into app_private.repair_shops(id,name,subscription_status,subscription_starts_at,subscription_ends_at) values($1,'Fictional race shop','active',clock_timestamp()-interval '1 day',clock_timestamp()+interval '1 day')",
    [shop],
  )
  await admin.query(
    "insert into app_private.repair_shop_staff(shop_id,user_id,role,active) values($1,$2,'admin',true)",
    [shop, users[1]],
  )
  await admin.query(
    "insert into public.vehicles(id,owner_id,type,make,model,year,engine,mileage) values($1,$2,'car','Fictional','Reminder race',2020,'Example',10000)",
    [vehicle, users[0]],
  )
  await admin.query(
    "insert into public.vehicle_maintenance_items(id,vehicle_id,name,interval_km,enabled,history_status,last_completed_mileage) values($1,$2,'Fictional oil',10000,true,'known',0)",
    [item, vehicle],
  )
  await admin.query(
    "insert into app_private.vehicle_shop_authorizations(id,shop_id,vehicle_id,ownership_epoch,initiated_by,status,approved_by,approved_at) select $1,$2,id,ownership_epoch,'owner','approved',owner_id,clock_timestamp() from public.vehicles where id=$3",
    [grant, shop, vehicle],
  )
  for (const isolation of [
    'read committed',
    'repeatable read',
    'serializable',
  ]) {
    await fixture()
    await begin(a, isolation)
    await begin(b, isolation)
    await send(a)
    const duplicate = settle(send(b))
    await waitForLock(b)
    await a.query('commit')
    assert.ok(
      ['P0001', '40001'].includes((await duplicate).error?.code),
      'Concurrent duplicate was not rejected',
    )
    await b.query('rollback')
    assert.equal(
      (
        await admin.query(
          'select count(*)::int n from app_private.shop_maintenance_reminders where shop_id=$1',
          [shop],
        )
      ).rows[0].n,
      1,
    )
    for (const [name, change] of Object.entries(changes)) {
      for (const sendFirst of [true, false]) {
        await fixture()
        await begin(a, isolation, sendFirst ? 1 : 0)
        await begin(b, isolation, sendFirst ? 0 : 1)
        if (sendFirst) await send(a)
        else await change(a)
        const pending = settle(sendFirst ? change(b) : send(b))
        await waitForLock(b)
        await a.query('commit')
        const result = await pending
        if (sendFirst) {
          assert.ok(
            !result.error || result.error.code === '40001',
            `${name}: unexpected losing transaction`,
          )
        } else
          assert.ok(
            ['42501', '40001'].includes(result.error?.code),
            `${name}: unauthorized send succeeded`,
          )
        await b.query(result.error ? 'rollback' : 'commit')
      }
    }
    // Recipient reads and transfers serialize without exposing the prior inbox.
    for (const readFirst of [true, false]) {
      await fixture()
      await begin(admin)
      await send(admin)
      await admin.query('commit')
      await begin(a, isolation, 0)
      await begin(b, isolation, 0)
      if (readFirst)
        await a.query(
          'select public.list_shop_maintenance_reminders() reminders',
        )
      else await changes.transfer(a)
      const pending = settle(
        readFirst
          ? changes.transfer(b)
          : b.query(
              'select public.list_shop_maintenance_reminders() reminders',
            ),
      )
      await waitForLock(b)
      await a.query('commit')
      const result = await pending
      if (result.error) assert.equal(result.error.code, '40001')
      else if (!readFirst) assert.deepEqual(result.value.rows[0].reminders, [])
      await b.query(result.error ? 'rollback' : 'commit')
    }
  }
  // Entitlement must be checked after waiting on the selected operation too.
  await fixture()
  await admin.query(
    "update app_private.repair_shops set subscription_ends_at=clock_timestamp()+interval '600 milliseconds' where id=$1",
    [shop],
  )
  await begin(b)
  await b.query('reset role')
  await b.query(
    'select 1 from public.vehicle_maintenance_items where id=$1 for update',
    [item],
  )
  await begin(a)
  const expired = settle(send(a))
  await waitForLock(a)
  await new Promise((resolve) => setTimeout(resolve, 650))
  await b.query('commit')
  assert.equal((await expired).error?.code, '42501')
  await a.query('rollback')
  // Parity with the existing TypeScript due-status rules, including unknown,
  // partial baselines, independent time/km intervals and month-end/leap dates.
  await fixture()
  const today = (
    await admin.query(
      "select (clock_timestamp() at time zone 'UTC')::date::text today",
    )
  ).rows[0].today
  const cases = [
    [true, 'known', 10000, null, null, 0],
    [true, 'known', 11000, null, null, 0],
    [true, 'known', 11001, null, null, 0],
    [false, 'known', 10000, null, null, 0],
    [true, 'unknown', 10000, null, null, null],
    [true, 'not_applicable', 10000, null, null, null],
    [true, 'known', null, 1, '2024-01-31', null],
    [true, 'known', null, 12, '2024-02-29', null],
    [true, 'known', 20000, 1, today, 0],
    [true, 'known', 10000, 1, null, 0],
  ]
  for (const [
    enabled,
    history_status,
    interval_km,
    interval_months,
    last_completed_date,
    last_completed_mileage,
  ] of cases) {
    const data = {
      enabled,
      history_status,
      interval_km,
      interval_months,
      last_completed_date,
      last_completed_mileage,
    }
    await admin.query(
      'update public.vehicle_maintenance_items set enabled=$2,history_status=$3,interval_km=$4,interval_months=$5,last_completed_date=$6,last_completed_mileage=$7 where id=$1',
      [
        item,
        enabled,
        history_status,
        interval_km,
        interval_months,
        last_completed_date,
        last_completed_mileage,
      ],
    )
    const due = (
      await admin.query('select app_private.shop_reminder_is_due($1,$2) due', [
        vehicle,
        item,
      ])
    ).rows[0].due
    assert.equal(
      due,
      ['Due / overdue', 'Due soon'].includes(
        calculateMaintenance(data, 10000, today).status,
      ),
    )
  }
  // Linked completions supersede baselines and carry one-time intervals.
  for (const [baselineDate, baselineKm, serviceDate, serviceKm, override] of [
    ['2025-01-01', 0, '2025-02-01', 9500, 500],
    ['2025-01-01', 0, '2025-02-01', 9500, 20000],
    ['2025-03-01', 9000, '2025-02-01', 5000, 500],
  ]) {
    await admin.query('delete from public.service_visits where vehicle_id=$1', [
      vehicle,
    ])
    await admin.query(
      "update public.vehicle_maintenance_items set enabled=true,history_status='known',interval_km=10000,interval_months=null,last_completed_date=$2,last_completed_mileage=$3 where id=$1",
      [item, baselineDate, baselineKm],
    )
    const visit = randomUUID(),
      operation = randomUUID()
    await admin.query(
      "insert into public.service_visits(id,vehicle_id,service_date,mileage,service_type) values($1,$2,$3,$4,'diy')",
      [visit, vehicle, serviceDate, serviceKm],
    )
    await admin.query(
      "insert into public.service_operations(id,service_visit_id,maintenance_item_id,operation_name,next_interval_km) values($1,$2,$3,'Fictional completion',$4)",
      [operation, visit, item, override],
    )
    const [effective] = applyServiceHistory(
      [
        {
          id: item,
          vehicle_id: vehicle,
          name: 'Example',
          enabled: true,
          history_status: 'known',
          interval_km: 10000,
          interval_months: null,
          last_completed_date: baselineDate,
          last_completed_mileage: baselineKm,
          created_at: '',
          updated_at: '',
        },
      ],
      [
        {
          id: visit,
          service_date: serviceDate,
          mileage: serviceKm,
          created_at: '',
          operations: [
            {
              id: operation,
              maintenance_item_id: item,
              next_interval_km: override,
              next_interval_months: null,
              created_at: '',
            },
          ],
        },
      ],
    )
    const due = (
      await admin.query('select app_private.shop_reminder_is_due($1,$2) due', [
        vehicle,
        item,
      ])
    ).rows[0].due
    assert.equal(
      due,
      ['Due / overdue', 'Due soon'].includes(
        calculateMaintenance(effective, 10000, today).status,
      ),
    )
  }
  console.log(
    'Task 7.8 concurrency PASS: duplicate and access races at all 3 isolation levels; due-status parity PASS',
  )
} finally {
  await a.query('rollback').catch(() => {})
  await b.query('rollback').catch(() => {})
  await admin.query('delete from public.vehicles where id=$1', [vehicle])
  await admin.query(
    'delete from app_private.repair_shop_staff where shop_id=$1',
    [shop],
  )
  await admin.query('delete from app_private.repair_shops where id=$1', [shop])
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
