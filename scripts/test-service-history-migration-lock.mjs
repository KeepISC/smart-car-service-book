// Never point this harness at a production database or a local production tunnel.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import pg from 'pg'

if (
  process.env.SCSB_DISPOSABLE_DATABASE_TEST !== 'true' ||
  process.env.PGHOST !== 'localhost' ||
  process.env.PGPORT !== '5432' ||
  process.env.PGDATABASE !== 'maintenance_test' ||
  process.env.PGUSER !== 'postgres'
)
  throw new Error('Migration-lock tests require the disposable local database')

const pool = new pg.Pool({
  max: 2,
  connectionTimeoutMillis: 5000,
  statement_timeout: 15000,
})
const blocker = await pool.connect()
const migrator = await pool.connect()
async function snapshot() {
  return (
    await migrator.query(`select
    to_regclass('public.service_visits') as visits,
    to_regclass('public.service_operations') as operations,
    has_column_privilege('authenticated','public.vehicle_maintenance_items','last_completed_date','UPDATE') as legacy_completion_update,
    (select pg_get_functiondef('public.validate_vehicle_mileage()'::regprocedure)) as mileage_guard,
    (select jsonb_agg(v order by id) from public.vehicles v) as vehicles,
    (select jsonb_agg(m order by id) from public.vehicle_maintenance_items m) as maintenance`)
  ).rows[0]
}
try {
  const before = await snapshot()
  assert.equal(before.visits, null)
  assert.equal(before.operations, null)
  assert.equal(before.legacy_completion_update, true)
  await blocker.query('begin; lock public.vehicles in row exclusive mode')
  const started = Date.now()
  await assert.rejects(
    migrator.query(
      await readFile(
        'supabase/migrations/202610120002_service_history.sql',
        'utf8',
      ),
    ),
    (error) => error.code === '55P03',
  )
  assert.ok(
    Date.now() - started < 10000,
    'Migration must abort its lock wait promptly',
  )
  await migrator.query('rollback')
  assert.deepEqual(await snapshot(), before)
  console.log(
    'PASS: blocked migration times out with unchanged rows, grants and mileage guard; no partial history schema',
  )
} finally {
  await migrator.query('rollback')
  await blocker.query('rollback')
  migrator.release()
  blocker.release()
  await pool.end()
}
