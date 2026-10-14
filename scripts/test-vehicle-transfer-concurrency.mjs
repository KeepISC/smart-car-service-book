// Mutating tests are restricted to fictional data in disposable local PostgreSQL.
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
  throw new Error('Transfer races require the disposable local database')

const pool = new pg.Pool({ max: 3, statement_timeout: 10000 })
const admin = await pool.connect()
const first = await pool.connect()
const second = await pool.connect()
const owners = [randomUUID(), randomUUID(), randomUUID()]
const uids = owners.map((owner) => `fictional-transfer-${owner}`)
const vehicle = randomUUID()
const visit = randomUUID()
const item = randomUUID()
let previousProject

async function begin(connection, isolation, ownerIndex) {
  await connection.query(`begin isolation level ${isolation}`)
  await connection.query('select set_config($1,$2,true)', [
    'request.jwt.claims',
    JSON.stringify({
      iss: 'https://securetoken.google.com/fictional-project',
      aud: 'fictional-project',
      sub: uids[ownerIndex],
      role: 'authenticated',
      email_verified: true,
      app_owner_id: owners[ownerIndex],
    }),
  ])
  await connection.query('set local role authenticated')
  // Establish a snapshot even when the tested call has not yet started.
  await connection.query('select count(*) from public.vehicles')
}

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
  throw new Error('Expected transfer synchronization lock was not observed')
}

async function fixture() {
  await admin.query('delete from public.vehicles where id=$1', [vehicle])
  await admin.query(
    "insert into public.vehicles(id,owner_id,type,make,model,year,engine,mileage) values($1,$2,'car','Fictional','Transfer race',2020,'Example',20000)",
    [vehicle, owners[0]],
  )
  await admin.query(
    "insert into public.vehicle_maintenance_items(id,vehicle_id,name,interval_km) values($1,$2,'Oil',10000)",
    [item, vehicle],
  )
  await admin.query(
    "insert into public.service_visits(id,vehicle_id,service_date,mileage,service_type,notes,private_on_transfer) values($1,$2,current_date-1,18000,'diy','Private original',true)",
    [visit, vehicle],
  )
  await admin.query(
    "insert into public.service_operations(service_visit_id,maintenance_item_id,operation_name,next_interval_km) values($1,$2,'Private operation',5000)",
    [visit, item],
  )
  await begin(first, 'read committed', 0)
  const invitation = (
    await first.query('select public.create_vehicle_transfer($1) invitation', [
      vehicle,
    ])
  ).rows[0].invitation
  await first.query('commit')
  return invitation
}

const accept = (connection, invitation) =>
  connection.query('select public.accept_vehicle_transfer($1)', [
    invitation.token,
  ])
const mutations = {
  scheduleEdit: (connection) =>
    connection.query(
      'update public.vehicle_maintenance_items set interval_km=11000 where id=$1',
      [item],
    ),
  mileage: (connection) =>
    connection.query('select public.update_vehicle_mileage($1,21000)', [
      vehicle,
    ]),
  privacy: (connection) =>
    connection.query(
      'select public.set_service_visit_transfer_privacy($1,$2,false)',
      [vehicle, visit],
    ),
  deleteSchedule: (connection) =>
    connection.query('select public.delete_vehicle_maintenance_item($1,$2)', [
      vehicle,
      item,
    ]),
  saveVisit: (connection) =>
    connection.query('select public.save_service_visit($1,$2,$3::jsonb)', [
      vehicle,
      visit,
      JSON.stringify({
        service_date: '2026-01-31',
        mileage: 19000,
        service_type: 'diy',
        notes: 'Edited private',
        operations: [
          {
            maintenance_item_id: item,
            operation_name: 'Private edited operation',
            next_interval_km: 6000,
          },
        ],
      }),
    ]),
}

try {
  previousProject = (
    await admin.query('select project_id from app_private.firebase_config')
  ).rows[0].project_id
  await admin.query(
    "update app_private.firebase_config set project_id='fictional-project'",
  )
  for (let index = 0; index < owners.length; index++) {
    await admin.query('insert into app_private.app_users(id) values($1)', [
      owners[index],
    ])
    await admin.query(
      'insert into app_private.firebase_identities(firebase_uid,owner_id) values($1,$2)',
      [uids[index], owners[index]],
    )
    await admin.query(
      'insert into app_private.firebase_provisioning_approvals(firebase_uid) values($1)',
      [uids[index]],
    )
  }
  const pid = (await second.query('select pg_backend_pid() pid')).rows[0].pid
  let races = 0
  for (const isolation of [
    'read committed',
    'repeatable read',
    'serializable',
  ]) {
    for (const competition of ['accept', 'revoke', 'decline']) {
      const invitation = await fixture()
      await begin(first, isolation, competition === 'revoke' ? 0 : 1)
      await begin(second, isolation, 2)
      if (competition === 'accept') await accept(first, invitation)
      else if (competition === 'revoke')
        await first.query('select public.revoke_vehicle_transfer($1,$2)', [
          vehicle,
          invitation.id,
        ])
      else
        await first.query('select public.decline_vehicle_transfer($1)', [
          invitation.token,
        ])
      const pending = accept(second, invitation).then(
        () => null,
        (error) => error,
      )
      await waitForLock(pid)
      await first.query('commit')
      const error = await pending
      assert.equal(
        error?.code,
        isolation === 'read committed' ? '42501' : '40001',
      )
      await second.query('rollback')
      const saved = (
        await admin.query(
          'select owner_id,ownership_epoch from public.vehicles where id=$1',
          [vehicle],
        )
      ).rows[0]
      assert.equal(saved.owner_id, owners[competition === 'accept' ? 1 : 0])
      assert.equal(saved.ownership_epoch, competition === 'accept' ? '1' : '0')
      races++
    }
    for (const [name, mutate] of Object.entries(mutations)) {
      for (const transferFirst of [false, true]) {
        const invitation = await fixture()
        await begin(first, isolation, transferFirst ? 1 : 0)
        await begin(second, isolation, transferFirst ? 0 : 1)
        if (transferFirst) await accept(first, invitation)
        else await mutate(first)
        const pending = (
          transferFirst ? mutate(second) : accept(second, invitation)
        ).then(
          () => null,
          (error) => error,
        )
        await waitForLock(pid)
        await first.query('commit')
        const error = await pending
        const expected =
          isolation !== 'read committed'
            ? '40001'
            : transferFirst
              ? '42501'
              : undefined
        assert.equal(
          error?.code,
          expected,
          `${isolation}: ${name}, transferFirst=${transferFirst}`,
        )
        await second.query(error ? 'rollback' : 'commit')
        if (!transferFirst && error) {
          await begin(second, 'read committed', 1)
          await accept(second, invitation)
          await second.query('commit')
        }
        const saved = (
          await admin.query(
            'select owner_id,mileage,ownership_epoch from public.vehicles where id=$1',
            [vehicle],
          )
        ).rows[0]
        assert.equal(saved.owner_id, owners[1])
        assert.equal(saved.ownership_epoch, '1')
        assert.equal(
          saved.mileage,
          !transferFirst && name === 'mileage' ? 21000 : 20000,
        )
        const history = (
          await admin.query(
            'select mileage from public.vehicle_mileage_history where vehicle_id=$1',
            [vehicle],
          )
        ).rows
        assert.deepEqual(
          history,
          !transferFirst && name === 'mileage' ? [{ mileage: 21000 }] : [],
        )
        const service = (
          await admin.query(
            'select notes,mileage from public.service_visits where id=$1',
            [visit],
          )
        ).rows[0]
        assert.equal(
          service.notes,
          !transferFirst && name === 'privacy' ? 'Private original' : null,
        )
        assert.equal(
          service.mileage,
          !transferFirst && name === 'saveVisit' ? 19000 : 18000,
        )
        assert.equal(
          (
            await admin.query(
              'select count(*)::integer count from public.vehicle_maintenance_items where id=$1',
              [item],
            )
          ).rows[0].count,
          !transferFirst && name === 'deleteSchedule' ? 0 : 1,
        )
        if (name === 'scheduleEdit')
          assert.equal(
            (
              await admin.query(
                'select interval_km from public.vehicle_maintenance_items where id=$1',
                [item],
              )
            ).rows[0].interval_km,
            transferFirst ? 10000 : 11000,
          )
        races++
      }
    }
    const invitation = await fixture()
    await admin.query(
      "update app_private.vehicle_transfer_invitations set expires_at=clock_timestamp()+interval '500 milliseconds' where id=$1",
      [invitation.id],
    )
    await begin(first, isolation, 0)
    await first.query('select 1 from public.vehicles where id=$1 for update', [
      vehicle,
    ])
    await begin(second, isolation, 1)
    const expiring = accept(second, invitation).then(
      () => null,
      (error) => error,
    )
    await waitForLock(pid)
    await admin.query('select pg_sleep(0.6)')
    await first.query('commit')
    assert.equal(
      (await expiring)?.code,
      '42501',
      'Expiry must use wall clock after lock wait',
    )
    await second.query('rollback')
    assert.equal(
      (
        await admin.query('select owner_id from public.vehicles where id=$1', [
          vehicle,
        ])
      ).rows[0].owner_id,
      owners[0],
    )
    races++
  }
  console.log(
    `PASS: ${races} deterministic transfer races across READ COMMITTED, REPEATABLE READ and SERIALIZABLE; replay, revocation, privacy, mileage, Service History and schedule deletion`,
  )
} finally {
  await first.query('rollback').catch(() => {})
  await second.query('rollback').catch(() => {})
  await admin.query('delete from public.vehicles where id=$1', [vehicle])
  for (let index = 0; index < owners.length; index++) {
    await admin.query('delete from app_private.app_users where id=$1', [
      owners[index],
    ])
    await admin.query(
      'delete from app_private.firebase_provisioning_approvals where firebase_uid=$1',
      [uids[index]],
    )
  }
  if (previousProject)
    await admin.query('update app_private.firebase_config set project_id=$1', [
      previousProject,
    ])
  first.release()
  second.release()
  admin.release()
  await pool.end()
}
