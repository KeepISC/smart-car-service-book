-- READ ONLY: safe after the approved migration, not a fixture or CRUD harness.
begin transaction read only;
set local statement_timeout = '20s';
set local lock_timeout = '2s';
select jsonb_build_object(
  'server_version', current_setting('server_version'),
  'read_only', current_setting('transaction_read_only'),
  'history_tables_forced_rls', (
    select count(*) = 2 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname in ('service_visits','service_operations')
      and c.relrowsecurity and c.relforcerowsecurity
  ),
  'history_select_allowed',
    has_table_privilege('authenticated','public.service_visits','SELECT')
    and has_table_privilege('authenticated','public.service_operations','SELECT'),
  'direct_history_mutations_denied',
    not has_table_privilege('authenticated','public.service_visits','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
    and not has_table_privilege('authenticated','public.service_operations','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'),
  'anonymous_history_access_denied',
    not has_table_privilege('anon','public.service_visits','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
    and not has_table_privilege('anon','public.service_operations','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
    and not has_function_privilege('anon','public.save_service_visit(uuid,uuid,jsonb)','EXECUTE')
    and not has_function_privilege('anon','public.delete_service_visit(uuid,uuid)','EXECUTE'),
  'authenticated_rpc_execution_allowed',
    has_function_privilege('authenticated','public.save_service_visit(uuid,uuid,jsonb)','EXECUTE')
    and has_function_privilege('authenticated','public.delete_service_visit(uuid,uuid)','EXECUTE'),
  'provisioner_history_mutation_denied',
    not has_function_privilege('scsb_provisioner','public.save_service_visit(uuid,uuid,jsonb)','EXECUTE')
    and not has_function_privilege('scsb_provisioner','public.delete_service_visit(uuid,uuid)','EXECUTE'),
  'legacy_grants_remain_narrow',
    has_column_privilege('authenticated','public.vehicle_maintenance_items','history_status','UPDATE')
    and has_column_privilege('authenticated','public.vehicle_maintenance_items','last_completed_date','UPDATE')
    and has_column_privilege('authenticated','public.vehicle_maintenance_items','last_completed_mileage','UPDATE')
    and not has_table_privilege('authenticated','public.vehicle_maintenance_items','UPDATE')
    and not has_column_privilege('authenticated','public.vehicle_maintenance_items','id','UPDATE')
    and not has_column_privilege('authenticated','public.vehicle_maintenance_items','vehicle_id','UPDATE'),
  'completion_source_guard_installed', exists (
    select 1 from pg_trigger t join pg_proc p on p.oid=t.tgfoid
    where t.tgrelid='public.vehicle_maintenance_items'::regclass
      and t.tgname='maintenance_completion_check' and t.tgenabled='O'
      and p.proname='validate_maintenance_completion'
      and p.proconfig @> array['search_path=""']
      and pg_get_functiondef(p.oid) like '%maintenance_completion_source_conflict%'
  ),
  'schedule_and_vehicle_edits_allowed',
    has_column_privilege('authenticated','public.vehicle_maintenance_items','name','UPDATE')
    and has_column_privilege('authenticated','public.vehicle_maintenance_items','interval_km','UPDATE')
    and has_column_privilege('authenticated','public.vehicle_maintenance_items','interval_months','UPDATE')
    and has_column_privilege('authenticated','public.vehicle_maintenance_items','enabled','UPDATE')
    and has_column_privilege('authenticated','public.vehicles','mileage','UPDATE'),
  'rpc_security', (
    select jsonb_agg(jsonb_build_object('name',p.proname,'owner',r.rolname,
      'definer',p.prosecdef,'empty_search_path',coalesce(p.proconfig @> array['search_path=""'],false),
      'owner_can_cross_forced_rls',r.rolbypassrls or r.rolsuper,
      'definition_hash',md5(pg_get_functiondef(p.oid))) order by p.proname)
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner
    where n.nspname='public' and p.proname in ('save_service_visit','delete_service_visit')
  ),
  'mileage_inconsistencies', (
    select count(*) from public.service_visits sv join public.vehicles v on v.id=sv.vehicle_id
    where sv.mileage>v.mileage
  ),
  'legacy_mileage_inconsistencies', (
    select count(*) from public.vehicle_maintenance_items m join public.vehicles v on v.id=m.vehicle_id
    where m.last_completed_mileage>v.mileage
  ),
  'cross_vehicle_schedule_references', (
    select count(*) from public.service_operations so
    join public.service_visits sv on sv.id=so.service_visit_id
    join public.vehicle_maintenance_items m on m.id=so.maintenance_item_id
    where sv.vehicle_id<>m.vehicle_id
  ),
  'orphan_history_references', (
    select count(*) from public.service_operations so left join public.service_visits sv on sv.id=so.service_visit_id
    left join public.vehicle_maintenance_items m on m.id=so.maintenance_item_id
    where sv.id is null or (so.maintenance_item_id is not null and m.id is null)
  ),
  'invalid_constraints', (
    select count(*) from pg_constraint k join pg_class c on c.oid=k.conrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname in ('service_visits','service_operations') and not k.convalidated
  )
) as service_history_postflight;
rollback;
