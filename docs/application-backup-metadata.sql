-- Read-only metadata/fingerprints for the three application backup schemas.
-- Run within the exported backup snapshot (or the disposable restored database).
with tables as (
  select c.oid, n.nspname as schema, c.relname as name, c.relrowsecurity as rls,
    c.relforcerowsecurity as forced, pg_get_userbyid(c.relowner) as owner
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'app_private', 'supabase_migrations') and c.relkind = 'r'
)
select jsonb_build_object(
  'schemas', (select jsonb_agg(jsonb_build_object('name', n.nspname, 'owner', pg_get_userbyid(n.nspowner),
    'acl', array(select unnest(n.nspacl)::text order by 1)) order by n.nspname)
    from pg_namespace n where n.nspname in ('public', 'app_private', 'supabase_migrations')),
  'tables', (select jsonb_agg(to_jsonb(t) - 'oid' order by schema, name) from tables t),
  'columns', (select jsonb_agg(jsonb_build_object('schema', t.schema, 'table', t.name,
    'name', a.attname, 'type', format_type(a.atttypid, a.atttypmod),
    'not_null', a.attnotnull, 'default', pg_get_expr(d.adbin, d.adrelid))
    order by t.schema, t.name, a.attnum)
    from tables t join pg_attribute a on a.attrelid = t.oid
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where a.attnum > 0 and not a.attisdropped),
  'constraints', (select jsonb_agg(jsonb_build_object('schema', t.schema, 'table', t.name,
    'name', c.conname, 'definition', pg_get_constraintdef(c.oid), 'validated', c.convalidated)
    order by t.schema, t.name, c.conname) from tables t join pg_constraint c on c.conrelid = t.oid),
  'indexes', (select jsonb_agg(jsonb_build_object('schema', t.schema, 'table', t.name,
    'name', c.relname, 'definition', pg_get_indexdef(i.indexrelid))
    order by t.schema, t.name, c.relname)
    from tables t join pg_index i on i.indrelid = t.oid join pg_class c on c.oid = i.indexrelid),
  'functions', (select jsonb_agg(jsonb_build_object('schema', n.nspname, 'name', p.proname,
    'args', pg_get_function_identity_arguments(p.oid), 'definition', pg_get_functiondef(p.oid),
    'owner', pg_get_userbyid(p.proowner), 'definer', p.prosecdef, 'settings', p.proconfig,
    'acl', array(select unnest(p.proacl)::text order by 1)) order by n.nspname, p.proname)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'app_private')),
  'triggers', (select jsonb_agg(jsonb_build_object('schema', t.schema, 'table', t.name,
    'name', g.tgname, 'enabled', g.tgenabled, 'definition', pg_get_triggerdef(g.oid))
    order by t.schema, t.name, g.tgname) from tables t join pg_trigger g on g.tgrelid = t.oid where not g.tgisinternal),
  'policies', (select jsonb_agg(to_jsonb(p) order by schemaname, tablename, policyname)
    from pg_policies p where schemaname in ('public', 'app_private', 'supabase_migrations')),
  'table_acl', (select jsonb_agg(jsonb_build_object('schema', t.schema, 'table', t.name,
    -- NULL means PostgreSQL's default owner privileges, not an empty ACL.
    'acl', array(select unnest(coalesce(c.relacl, acldefault('r', c.relowner)))::text order by 1))
    order by t.schema, t.name) from tables t join pg_class c on c.oid = t.oid),
  'column_acl', (select jsonb_agg(jsonb_build_object('schema', t.schema, 'table', t.name,
    'column', a.attname, 'acl', array(select unnest(a.attacl)::text order by 1)) order by t.schema, t.name, a.attnum)
    from tables t join pg_attribute a on a.attrelid = t.oid where a.attnum > 0 and a.attacl is not null)
) as catalog;
