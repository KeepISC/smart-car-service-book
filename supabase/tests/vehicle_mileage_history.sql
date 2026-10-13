-- Disposable database only; simulated claims exercise RLS, not JWT verification.
begin;
update app_private.firebase_config set project_id = 'fictional-project' where singleton;
insert into app_private.app_users(id) values
  ('00000000-0000-4000-8000-000000005201'), ('00000000-0000-4000-8000-000000005202');
insert into app_private.firebase_identities(firebase_uid, owner_id) values
  ('fictional-mileage-a', '00000000-0000-4000-8000-000000005201'),
  ('fictional-mileage-b', '00000000-0000-4000-8000-000000005202');
insert into app_private.firebase_provisioning_approvals(firebase_uid) values
  ('fictional-mileage-a'), ('fictional-mileage-b');
insert into public.vehicles(id, owner_id, type, make, model, year, engine, mileage) values
  ('00000000-0000-4000-8000-000000005203', '00000000-0000-4000-8000-000000005201', 'car', 'Fictional', 'Mileage', 2020, 'Example', 20000);

do $$ begin
  if not exists (select 1 from pg_class where oid = 'public.vehicle_mileage_history'::regclass
    and relrowsecurity and relforcerowsecurity) then raise exception 'Forced history RLS missing'; end if;
  if exists (select 1 from public.vehicle_mileage_history where vehicle_id = '00000000-0000-4000-8000-000000005203')
    then raise exception 'Invented baseline'; end if;
  if has_function_privilege('authenticated', 'public.record_vehicle_mileage()', 'execute')
    or has_function_privilege('anon', 'public.update_vehicle_mileage(uuid,integer)', 'execute')
    then raise exception 'Unexpected function grants'; end if;
end; $$;

set local role authenticated;
set local request.jwt.claims = '{"iss":"https://securetoken.google.com/fictional-project","aud":"fictional-project","sub":"fictional-mileage-a","role":"authenticated","email_verified":true,"app_owner_id":"00000000-0000-4000-8000-000000005201"}';
do $$
declare saved public.vehicles;
begin
  saved := public.update_vehicle_mileage('00000000-0000-4000-8000-000000005203', 21000);
  if saved.mileage <> 21000 or saved.model <> 'Mileage' then raise exception 'RPC response incorrect'; end if;
  if (select count(*) from public.vehicle_mileage_history where vehicle_id = saved.id and mileage = 21000
      and source = 'manual' and recorded_at is not null) <> 1 then raise exception 'Missing accepted update'; end if;
  perform public.update_vehicle_mileage(saved.id, 21000);
  -- Real changes through the existing vehicle editor also append atomically.
  update public.vehicles set mileage = 22000, model = 'Edited' where id = saved.id;
  insert into public.vehicle_maintenance_items(vehicle_id, name, interval_km, history_status, last_completed_mileage)
    values (saved.id, 'Fictional completion', 1000, 'known', 21500);
  -- Completion locking touches the row but must not create fake manual history.
  if (select count(*) from public.vehicle_mileage_history where vehicle_id = saved.id) <> 2
    then raise exception 'No-op created history or editor failed to append'; end if;
  begin
    perform public.update_vehicle_mileage(saved.id, 21999);
    raise exception 'RPC accepted a decrease';
  exception when check_violation then null; end;
  begin
    update public.vehicles set mileage = 21499 where id = saved.id;
    raise exception 'Maintenance consistency weakened';
  exception when check_violation then null; end;
  begin
    perform public.update_vehicle_mileage(saved.id, null);
    raise exception 'Null mileage accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.update_vehicle_mileage(saved.id, -1);
    raise exception 'Negative mileage accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.update_vehicle_mileage(saved.id, 10000001);
    raise exception 'Excessive mileage accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.update_vehicle_mileage('00000000-0000-4000-8000-000000005299', 23000);
    raise exception 'Missing vehicle update accepted';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.vehicle_mileage_history(vehicle_id, mileage, source) values (saved.id, 999999, 'manual');
    raise exception 'History forgery allowed';
  exception when insufficient_privilege then null; end;
  begin
    update public.vehicle_mileage_history set mileage = 999999 where vehicle_id = saved.id;
    raise exception 'History tampering allowed';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.vehicle_mileage_history where vehicle_id = saved.id;
    raise exception 'History deletion allowed';
  exception when insufficient_privilege then null; end;
end;
$$;

-- Deliberate append failure must roll back the parent mutation.
reset role;
create function public.fictional_fail_history_append() returns trigger language plpgsql as $$
begin raise exception 'Fictional append failure' using errcode = '23514'; end; $$;
create trigger fictional_fail_history_append before insert on public.vehicle_mileage_history
  for each row execute function public.fictional_fail_history_append();
set local role authenticated;
do $$ begin
  begin
    perform public.update_vehicle_mileage('00000000-0000-4000-8000-000000005203', 23000);
    raise exception 'Append failure did not abort';
  exception when check_violation then null; end;
  if (select mileage from public.vehicles where id = '00000000-0000-4000-8000-000000005203') <> 22000
    or (select count(*) from public.vehicle_mileage_history) <> 2 then raise exception 'Atomic rollback failed'; end if;
end; $$;
reset role;
drop trigger fictional_fail_history_append on public.vehicle_mileage_history;
drop function public.fictional_fail_history_append();

-- Service History uses a no-op parent update and retains its mileage guard.
insert into public.service_visits(vehicle_id, service_date, mileage, service_type)
  values ('00000000-0000-4000-8000-000000005203', '2026-01-01', 21900, 'diy');
set local role authenticated;
do $$ begin
  begin
    update public.vehicles set mileage = 21800 where id = '00000000-0000-4000-8000-000000005203';
    raise exception 'Service History consistency weakened';
  exception when check_violation then null; end;
  if (select count(*) from public.vehicle_mileage_history) <> 2 then raise exception 'Rejected update appended'; end if;
end; $$;

set local request.jwt.claims = '{"iss":"https://securetoken.google.com/fictional-project","aud":"fictional-project","sub":"fictional-mileage-b","role":"authenticated","email_verified":true,"app_owner_id":"00000000-0000-4000-8000-000000005202"}';
do $$ begin
  if exists (select 1 from public.vehicle_mileage_history) then raise exception 'Cross-owner history leaked'; end if;
  begin
    perform public.update_vehicle_mileage('00000000-0000-4000-8000-000000005203', 23000);
    raise exception 'Cross-owner mileage update accepted';
  exception when insufficient_privilege then null; end;
end; $$;
-- A forged UUID cannot bypass the Firebase identity mapping.
set local request.jwt.claims = '{"iss":"https://securetoken.google.com/fictional-project","aud":"fictional-project","sub":"fictional-mileage-b","role":"authenticated","email_verified":true,"app_owner_id":"00000000-0000-4000-8000-000000005201"}';
do $$ begin
  if exists (select 1 from public.vehicle_mileage_history) then raise exception 'Forged owner read accepted'; end if;
  begin
    perform public.update_vehicle_mileage('00000000-0000-4000-8000-000000005203', 23000);
    raise exception 'Forged owner write accepted';
  exception when insufficient_privilege then null; end;
end; $$;
reset role;
update app_private.firebase_provisioning_approvals set enabled = false where firebase_uid = 'fictional-mileage-a';
set local role authenticated;
set local request.jwt.claims = '{"iss":"https://securetoken.google.com/fictional-project","aud":"fictional-project","sub":"fictional-mileage-a","role":"authenticated","email_verified":true,"app_owner_id":"00000000-0000-4000-8000-000000005201"}';
do $$ begin
  if exists (select 1 from public.vehicle_mileage_history) then raise exception 'Disabled identity read accepted'; end if;
  begin
    perform public.update_vehicle_mileage('00000000-0000-4000-8000-000000005203', 23000);
    raise exception 'Disabled identity write accepted';
  exception when insufficient_privilege then null; end;
end; $$;
reset role;
update app_private.firebase_provisioning_approvals set enabled = true where firebase_uid = 'fictional-mileage-a';
set local role anon;
do $$ begin
  begin
    perform 1 from public.vehicle_mileage_history;
    raise exception 'Anonymous history access accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform public.update_vehicle_mileage('00000000-0000-4000-8000-000000005203', 23000);
    raise exception 'Anonymous RPC accepted';
  exception when insufficient_privilege then null; end;
end; $$;

set local role authenticated;
set local request.jwt.claims = '{"iss":"https://securetoken.google.com/fictional-project","aud":"fictional-project","sub":"fictional-mileage-a","role":"authenticated","email_verified":true,"app_owner_id":"00000000-0000-4000-8000-000000005201"}';
delete from public.vehicles where id = '00000000-0000-4000-8000-000000005203';
reset role;
do $$ begin
  if exists (select 1 from public.vehicle_mileage_history where vehicle_id = '00000000-0000-4000-8000-000000005203')
    then raise exception 'Vehicle deletion left orphan history'; end if;
end; $$;
rollback;
select 'PASS: mileage history, append-only grants, owner isolation, invalid/decreasing updates, maintenance/service guards, atomic rollback, cascade deletion' as result;
