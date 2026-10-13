// Fictional data and synchronization hooks are confined to disposable PostgreSQL.
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
  throw new Error('Lock-order tests require the disposable local database')

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
const uid = `fictional-lock-order-${owner}`
const gate = 730120003
let previousProject
let hookCreated = false

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
}
async function waitForLock(pid, event) {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    const { rows } = await admin.query(
      'select wait_event_type,wait_event from pg_stat_activity where pid=$1',
      [pid],
    )
    if (
      rows[0]?.wait_event_type === 'Lock' &&
      (!event || rows[0].wait_event === event)
    )
      return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('Expected synchronization lock was not observed')
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
    "insert into public.vehicles(id,owner_id,type,make,model,year,engine,mileage) values($1,$2,'car','Fictional','Lock ordering',2020,'Example',20000)",
    [vehicle, owner],
  )
  await admin.query(`create function public.task3_test_insert_gate() returns trigger language plpgsql set search_path='' as $$
    begin
      if pg_catalog.current_setting('scsb.test_gate',true)='on' then
        perform pg_catalog.pg_advisory_xact_lock(${gate});
      end if;
      return new;
    end; $$`)
  await admin.query(
    'create trigger task3_test_insert_gate before insert on public.service_operations for each row execute function public.task3_test_insert_gate()',
  )
  hookCreated = true
  const firstPid = (await first.query('select pg_backend_pid() pid')).rows[0]
    .pid
  const secondPid = (await second.query('select pg_backend_pid() pid')).rows[0]
    .pid
  for (const isolation of [
    'read committed',
    'repeatable read',
    'serializable',
  ]) {
    for (const mutation of ['delete', 'interval edit']) {
      const schedule = (
        await admin.query(
          "insert into public.vehicle_maintenance_items(vehicle_id,name,interval_km) values($1,'Fictional linked schedule',10000) returning id",
          [vehicle],
        )
      ).rows[0].id
      const visit = (
        await admin.query(
          "insert into public.service_visits(vehicle_id,service_date,mileage,service_type) values($1,current_date-1,15000,'diy') returning id",
          [vehicle],
        )
      ).rows[0].id
      await admin.query(
        "insert into public.service_operations(service_visit_id,maintenance_item_id,operation_name) values($1,$2,'Fictional original operation')",
        [visit, schedule],
      )
      await admin.query('select pg_advisory_lock($1)', [gate])
      await begin(first, isolation)
      await first.query("set local scsb.test_gate='on'")
      const save = first
        .query(
          `select public.save_service_visit($1,$2,jsonb_build_object(
      'service_date',(current_date-1)::text,'mileage',15000,'service_type','diy',
      'operations',jsonb_build_array(jsonb_build_object('maintenance_item_id',$3::text,'operation_name','Fictional edited operation'))))`,
          [vehicle, visit, schedule],
        )
        .then(
          () => null,
          (error) => error,
        )
      await waitForLock(firstPid, 'advisory')
      await begin(second, isolation)
      const mutationSql =
        mutation === 'delete'
          ? 'delete from public.vehicle_maintenance_items where id=$1'
          : 'update public.vehicle_maintenance_items set interval_km=11000 where id=$1'
      const deletion = second.query(mutationSql, [schedule]).then(
        () => null,
        (error) => error,
      )
      await waitForLock(secondPid)
      await admin.query('select pg_advisory_unlock($1)', [gate])
      const saveError = await save
      await first.query(saveError ? 'rollback' : 'commit')
      const deleteError = await deletion
      await second.query(deleteError ? 'rollback' : 'commit')
      console.log(
        'LOCK ORDER',
        isolation,
        mutation,
        'save',
        saveError?.code ?? 'committed',
        'delete',
        deleteError?.code ?? 'committed',
      )
      assert.equal(
        saveError,
        null,
        'Service edit must not deadlock with schedule deletion',
      )
      if (deleteError) {
        assert.equal(
          deleteError.code,
          '40001',
          'Only a safe snapshot retry is acceptable',
        )
        await begin(second, 'read committed')
        await second.query(mutationSql, [schedule])
        await second.query('commit')
      }
      const operations = (
        await admin.query(
          'select maintenance_item_id,operation_name from public.service_operations where service_visit_id=$1',
          [visit],
        )
      ).rows
      assert.equal(operations.length, 1)
      assert.equal(
        operations[0].maintenance_item_id,
        mutation === 'delete' ? null : schedule,
      )
      assert.equal(operations[0].operation_name, 'Fictional edited operation')
      if (mutation === 'interval edit') {
        assert.equal(
          (
            await admin.query(
              'select interval_km from public.vehicle_maintenance_items where id=$1',
              [schedule],
            )
          ).rows[0].interval_km,
          11000,
        )
        await admin.query(
          'delete from public.vehicle_maintenance_items where id=$1',
          [schedule],
        )
      }
      await admin.query('delete from public.service_visits where id=$1', [
        visit,
      ])
    }
  }

  for (const isolation of [
    'read committed',
    'repeatable read',
    'serializable',
  ]) {
    const schedule = (
      await admin.query(
        "insert into public.vehicle_maintenance_items(vehicle_id,name,interval_km) values($1,'Fictional deletion-first schedule',10000) returning id",
        [vehicle],
      )
    ).rows[0].id
    const visit = (
      await admin.query(
        "insert into public.service_visits(vehicle_id,service_date,mileage,service_type) values($1,current_date-1,15000,'diy') returning id",
        [vehicle],
      )
    ).rows[0].id
    await admin.query(
      "insert into public.service_operations(service_visit_id,maintenance_item_id,operation_name) values($1,$2,'Fictional preserved original')",
      [visit, schedule],
    )
    await begin(second, isolation)
    await second.query(
      'delete from public.vehicle_maintenance_items where id=$1',
      [schedule],
    )
    await begin(first, isolation)
    const save = first
      .query(
        `select public.save_service_visit($1,$2,jsonb_build_object('service_date',(current_date-1)::text,'mileage',15000,'service_type','diy','operations',jsonb_build_array(jsonb_build_object('maintenance_item_id',$3::text,'operation_name','Fictional rejected edit'))))`,
        [vehicle, visit, schedule],
      )
      .then(
        () => null,
        (error) => error,
      )
    await waitForLock(firstPid)
    await second.query('commit')
    const error = await save
    assert.equal(
      error?.code,
      isolation === 'read committed' ? '42501' : '40001',
    )
    await first.query('rollback')
    const rows = (
      await admin.query(
        'select maintenance_item_id,operation_name from public.service_operations where service_visit_id=$1',
        [visit],
      )
    ).rows
    assert.deepEqual(rows, [
      {
        maintenance_item_id: null,
        operation_name: 'Fictional preserved original',
      },
    ])
    await admin.query('delete from public.service_visits where id=$1', [visit])
    console.log(
      'LOCK ORDER',
      isolation,
      'schedule deletion first: rejected edit rolled back',
    )
  }
  console.log(
    'PASS: nine deterministic service/schedule delete and interval-edit races preserve snapshots without deadlocks',
  )
} finally {
  await first.query('rollback')
  await second.query('rollback')
  await admin.query('select pg_advisory_unlock($1)', [gate])
  if (hookCreated) {
    await admin.query(
      'drop trigger task3_test_insert_gate on public.service_operations',
    )
    await admin.query('drop function public.task3_test_insert_gate()')
  }
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
