-- Disposable database only. All fictional fixtures and configuration changes roll back.
begin;
update app_private.firebase_config set project_id = 'fictional-project' where singleton;
insert into app_private.app_users(id) values
  ('00000000-0000-4000-8000-00000000c201'), ('00000000-0000-4000-8000-00000000d201');
insert into app_private.firebase_identities(firebase_uid,owner_id) values
  ('fictional-consistency-a','00000000-0000-4000-8000-00000000c201'),
  ('fictional-consistency-b','00000000-0000-4000-8000-00000000d201');
insert into app_private.firebase_provisioning_approvals(firebase_uid) values
  ('fictional-consistency-a'), ('fictional-consistency-b');
insert into public.vehicles(id,owner_id,type,make,model,year,engine,mileage) values
  ('00000000-0000-4000-8000-00000000c202','00000000-0000-4000-8000-00000000c201','car','Fictional','Consistency A',2020,'Example',20000),
  ('00000000-0000-4000-8000-00000000d202','00000000-0000-4000-8000-00000000d201','car','Fictional','Consistency B',2020,'Example',30000);
set local request.jwt.claims = '{"iss":"https://securetoken.google.com/fictional-project","aud":"fictional-project","sub":"fictional-consistency-a","role":"authenticated","email_verified":true,"app_owner_id":"00000000-0000-4000-8000-00000000c201"}';
set local role authenticated;
insert into public.vehicle_maintenance_items(id,vehicle_id,name,interval_km,history_status,last_completed_mileage,last_completed_date,enabled) values
  ('00000000-0000-4000-8000-00000000c203','00000000-0000-4000-8000-00000000c202','Fictional recent completion',1000,'known',18000,'2026-01-01',true),
  ('00000000-0000-4000-8000-00000000c204','00000000-0000-4000-8000-00000000c202','Fictional older disabled completion',1000,'known',19000,'2025-01-01',false);
do $$
begin
  begin
    update public.vehicles set mileage=10000 where id='00000000-0000-4000-8000-00000000c202';
    raise exception 'Original 20000/18000/10000 odometer bug remains';
  exception when check_violation then null; end;
  begin
    update public.vehicles set mileage=18000 where id='00000000-0000-4000-8000-00000000c202';
    raise exception 'Older or disabled historical mileage was ignored';
  exception when check_violation then null; end;
  update public.vehicles set mileage=19000 where id='00000000-0000-4000-8000-00000000c202';
  begin
    update public.vehicle_maintenance_items set last_completed_mileage=19500
      where id='00000000-0000-4000-8000-00000000c203';
    raise exception 'Completion edit exceeded current odometer';
  exception when check_violation then null; end;
  begin
    insert into public.vehicle_maintenance_items(vehicle_id,name,interval_months,history_status,last_completed_mileage)
      values ('00000000-0000-4000-8000-00000000c202','Fictional invalid completion',12,'known',20000);
    raise exception 'Completion insert exceeded current odometer';
  exception when check_violation then null; end;
  if (select mileage from public.vehicles where id='00000000-0000-4000-8000-00000000c202') <> 19000
    or (select last_completed_mileage from public.vehicle_maintenance_items where id='00000000-0000-4000-8000-00000000c203') <> 18000
  then raise exception 'Rejected write changed existing history'; end if;
  update public.vehicle_maintenance_items set last_completed_mileage=18000
    where id='00000000-0000-4000-8000-00000000c204';
  update public.vehicles set mileage=18000 where id='00000000-0000-4000-8000-00000000c202';
end;
$$;
set local request.jwt.claims = '{"iss":"https://securetoken.google.com/fictional-project","aud":"fictional-project","sub":"fictional-consistency-b","role":"authenticated","email_verified":true,"app_owner_id":"00000000-0000-4000-8000-00000000d201"}';
do $$
declare affected integer;
begin
  update public.vehicles set mileage=0 where id='00000000-0000-4000-8000-00000000c202';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Cross-owner odometer edit succeeded'; end if;
  update public.vehicle_maintenance_items set last_completed_mileage=0
    where id='00000000-0000-4000-8000-00000000c203';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Cross-owner completion edit succeeded'; end if;
  begin
    insert into public.vehicle_maintenance_items(vehicle_id,name,interval_months)
      values ('00000000-0000-4000-8000-00000000c202','Fictional foreign vehicle',12);
    raise exception 'Parent lock bypassed ownership';
  exception when insufficient_privilege then null; end;
end;
$$;
reset role;
do $$
begin
  if (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname in ('vehicles','vehicle_maintenance_items')
        and c.relrowsecurity and c.relforcerowsecurity) <> 2
    then raise exception 'Odometer migration weakened RLS'; end if;
end;
$$;
rollback;
select 'PASS: original odometer regression, equality, historical maxima, inserts/edits, atomic rejection and owner isolation' as result;
