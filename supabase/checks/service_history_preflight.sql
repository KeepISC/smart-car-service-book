-- READ ONLY: metadata and aggregate compatibility checks, never fixture writes.
begin transaction read only;
set local statement_timeout = '20s';
set local lock_timeout = '2s';
select jsonb_build_object(
  'server_version', current_setting('server_version'),
  'read_only', current_setting('transaction_read_only'),
  'history', (select jsonb_agg(jsonb_build_object('version',version,'name',name) order by version) from supabase_migrations.schema_migrations),
  'visits_name_available', to_regclass('public.service_visits') is null,
  'operations_name_available', to_regclass('public.service_operations') is null,
  'rpc_names_available', not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('save_service_visit','delete_service_visit','validate_service_visit')
  ),
  'mileage_inconsistencies', (
    select count(*) from public.vehicle_maintenance_items m join public.vehicles v on v.id=m.vehicle_id
    where m.last_completed_mileage>v.mileage
  ),
  'orphan_maintenance', (
    select count(*) from public.vehicle_maintenance_items m left join public.vehicles v on v.id=m.vehicle_id where v.id is null
  ),
  'orphan_vehicle_owners', (
    select count(*) from public.vehicles v left join app_private.app_users u on u.id=v.owner_id where u.id is null
  ),
  'unsupported_completion_dates', (
    select count(*) from public.vehicle_maintenance_items where last_completed_date>current_date or last_completed_date<date '0001-01-01'
  ),
  'inconsistent_history_status', (
    select count(*) from public.vehicle_maintenance_items
    where not ((history_status='known' and (last_completed_date is not null or last_completed_mileage is not null))
      or (history_status in ('unknown','not_applicable') and last_completed_date is null and last_completed_mileage is null))
  ),
  'firebase_project_matches', exists (
    select 1 from app_private.firebase_config where singleton and project_id='smart-car-service-book-61a9d'
  ),
  'legacy_completion_update_currently_allowed',
    has_column_privilege('authenticated','public.vehicle_maintenance_items','last_completed_date','UPDATE'),
  'long_transactions', (
    select count(*) from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid() and xact_start<now()-interval '1 minute'
  ),
  'waiting_application_locks', (
    select count(*) from pg_locks where relation in ('public.vehicles'::regclass,'public.vehicle_maintenance_items'::regclass) and not granted
  )
) as service_history_preflight;
rollback;
