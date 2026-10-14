import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'

export async function readRecoverySchemaSecurity(client) {
  const schemas = (
    await client.query(`select n.nspname name,
    pg_get_userbyid(n.nspowner) owner,array(select unnest(n.nspacl)::text order by 1) acl
    from pg_namespace n where n.nspname in ('public','app_private','supabase_migrations')
    order by n.nspname`)
  ).rows
  const defaults = (
    await client.query(`select pg_get_userbyid(d.defaclrole) role,
    n.nspname schema,d.defaclobjtype type,array(select unnest(d.defaclacl)::text order by 1) acl
    from pg_default_acl d left join pg_namespace n on n.oid=d.defaclnamespace
    where n.nspname in ('public','app_private','supabase_migrations')
    order by 1,2,3`)
  ).rows
  const database = (
    await client.query(`select pg_get_userbyid(datdba) owner,
    pg_has_role(current_user,'pg_database_owner','USAGE') executor_in_database_owner
    from pg_database where datname=current_database()`)
  ).rows[0]
  return { schemas, defaults, database }
}

export async function preparePublicSchemaRestore(
  client,
  archiveList,
  listPath,
) {
  // pg_dump records public ACL changes relative to the initdb schema. Dropping
  // that schema loses its implicit PUBLIC USAGE grant before those changes run.
  const bootstrap = (
    await client.query(`select pg_get_userbyid(n.nspowner) owner,
    array(select unnest(n.nspacl)::text order by 1) acl
    from pg_namespace n where n.nspname='public'`)
  ).rows[0]
  assert.deepEqual(
    bootstrap,
    {
      owner: 'pg_database_owner',
      acl: ['=U/pg_database_owner', 'pg_database_owner=UC/pg_database_owner'],
    },
    'Restore requires the untouched PostgreSQL public schema',
  )
  let omitted = 0
  const selection = archiveList
    .split(/\r?\n/)
    .map((line) => {
      if (!/^\d+; \d+ \d+ SCHEMA - public /.test(line)) return line
      assert.match(
        line,
        / SCHEMA - public pg_database_owner$/,
        'Review a different archived public schema owner',
      )
      omitted++
      // Omit creation only. Keep schema ACL, comments and default-privilege entries.
      return '; ' + line
    })
    .join('\n')
  assert.equal(omitted, 1, 'Expected exactly one public schema creation entry')
  await writeFile(listPath, selection, { flag: 'wx', mode: 0o600 })
}
