// Disposable CI database only. This script never accepts a remote connection URL.
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
    'Concurrent provisioning tests require the explicit disposable CI database.',
  )
}
const database = new pg.Pool({
  max: 8,
  connectionTimeoutMillis: 5000,
  statement_timeout: 15000,
})
const uid = `fictional-concurrency-${randomUUID()}`
let configured = false
let previousProject
try {
  previousProject = (
    await database.query(
      'select project_id from app_private.firebase_config where singleton',
    )
  ).rows[0]?.project_id
  if (!previousProject)
    throw new Error('Disposable migration project configuration is missing')
  await database.query(
    "update app_private.firebase_config set project_id = 'fictional-project' where singleton",
  )
  configured = true
  const ownerCount = Number(
    (
      await database.query(
        'select count(*) as count from app_private.app_users',
      )
    ).rows[0].count,
  )
  const provision = async () => {
    const connection = await database.connect()
    try {
      await connection.query('begin')
      await connection.query('set local role scsb_provisioner')
      const result = await connection.query(
        'select app_private.provision_firebase_owner($1, $2) as owner_id',
        [uid, 'fictional-project'],
      )
      await connection.query('commit')
      return result.rows[0].owner_id
    } catch (error) {
      await connection.query('rollback')
      throw error
    } finally {
      connection.release()
    }
  }
  const owners = await Promise.all(Array.from({ length: 8 }, provision))
  assert.equal(new Set(owners).size, 1)
  assert.equal(
    Number(
      (
        await database.query(
          'select count(*) as count from app_private.app_users',
        )
      ).rows[0].count,
    ),
    ownerCount + 1,
  )
  assert.equal(
    Number(
      (
        await database.query(
          'select count(*) as count from app_private.firebase_identities where firebase_uid=$1',
          [uid],
        )
      ).rows[0].count,
    ),
    1,
  )
  console.log(
    'PASS: eight concurrent PostgreSQL provisioning requests created one owner and mapping.',
  )
} finally {
  await database.query(
    'delete from app_private.app_users where id in (select owner_id from app_private.firebase_identities where firebase_uid=$1)',
    [uid],
  )
  await database.query(
    'delete from app_private.firebase_provisioning_approvals where firebase_uid=$1',
    [uid],
  )
  if (configured)
    await database.query(
      'update app_private.firebase_config set project_id = $1 where singleton',
      [previousProject],
    )
  await database.end()
}
