-- Disposable test database only: simulated claims test PostgreSQL authorization, not JWT signatures.
begin;
-- Existing owner UUIDs, records and maintenance relationships must survive the migration.
do $$ begin
  if not exists (select 1 from public.vehicles where id='00000000-0000-4000-8000-00000000a102'
    and owner_id='00000000-0000-4000-8000-00000000a101' and mileage=1234)
    then raise exception 'Legacy vehicle changed during migration'; end if;
  if not exists (select 1 from public.vehicle_maintenance_items where id='00000000-0000-4000-8000-00000000a103'
    and vehicle_id='00000000-0000-4000-8000-00000000a102') then raise exception 'Legacy maintenance relationship changed'; end if;
end; $$;
-- Override the seeded project only inside this rolled-back disposable fixture.
update app_private.firebase_config set project_id = 'fictional-project' where singleton;
insert into app_private.app_users (id) values
  ('00000000-0000-4000-8000-00000000e001'), ('00000000-0000-4000-8000-00000000f001');
insert into app_private.firebase_identities (firebase_uid, owner_id) values
  ('fictional-firebase-e', '00000000-0000-4000-8000-00000000e001'),
  ('fictional-firebase-f', '00000000-0000-4000-8000-00000000f001');
insert into app_private.firebase_provisioning_approvals(firebase_uid) values
  ('fictional-firebase-e'), ('fictional-firebase-f');
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000a101';
set local request.jwt.claims = '{"iss":"https://abcdefghijklmnopqrst.supabase.co/auth/v1","aud":"authenticated","sub":"00000000-0000-4000-8000-00000000a101","role":"authenticated"}';
do $$ begin
  if (select count(*) from public.vehicles where id='00000000-0000-4000-8000-00000000a102') <> 1 then raise exception 'Legacy access lost'; end if;
end; $$;
set local request.jwt.claims = '{"iss":"https://securetoken.google.com/fictional-project","aud":"fictional-project","sub":"fictional-firebase-e","role":"authenticated","email_verified":true,"app_owner_id":"00000000-0000-4000-8000-00000000e001"}';
insert into public.vehicles (id, type, make, model, year, engine, mileage) values
  ('00000000-0000-4000-8000-00000000e002', 'car', 'Fictional Motors', 'Identity example', 2020, 'Example', 10000);
insert into public.vehicle_maintenance_items (id, vehicle_id, name, interval_km) values
  ('00000000-0000-4000-8000-00000000e003', '00000000-0000-4000-8000-00000000e002', 'Example maintenance', 1000);
do $$
declare affected integer;
begin
  if public.current_app_owner() <> '00000000-0000-4000-8000-00000000e001'::uuid then raise exception 'Owner mapping failed'; end if;
  if (select count(*) from public.vehicles where id='00000000-0000-4000-8000-00000000e002') <> 1 then raise exception 'Owner vehicle read failed'; end if;
  update public.vehicle_maintenance_items set interval_km=2000 where id='00000000-0000-4000-8000-00000000e003';
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Owner maintenance update failed'; end if;
  begin
    insert into app_private.firebase_identities(firebase_uid,owner_id) values ('forged', '00000000-0000-4000-8000-00000000f001');
    raise exception 'Untrusted identity provisioning succeeded';
  exception when insufficient_privilege then null;
  end;
end;
$$;
set local request.jwt.claims = '{"iss":"https://securetoken.google.com/fictional-project","aud":"fictional-project","sub":"fictional-firebase-f","role":"authenticated","email_verified":true,"app_owner_id":"00000000-0000-4000-8000-00000000f001"}';
do $$
declare affected integer;
begin
  if exists (select 1 from public.vehicles where id='00000000-0000-4000-8000-00000000e002') then raise exception 'Cross-owner vehicle read succeeded'; end if;
  if exists (select 1 from public.vehicle_maintenance_items where id='00000000-0000-4000-8000-00000000e003') then raise exception 'Cross-owner maintenance read succeeded'; end if;
  update public.vehicle_maintenance_items set enabled=false where id='00000000-0000-4000-8000-00000000e003';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Cross-owner update succeeded'; end if;
  delete from public.vehicles where id='00000000-0000-4000-8000-00000000e002';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Cross-owner deletion succeeded'; end if;
  begin
    insert into public.vehicles(owner_id,type,make,model,year,engine,mileage) values ('00000000-0000-4000-8000-00000000e001','car','Fictional','Forbidden',2020,'Example',0);
    raise exception 'Forged owner insert succeeded';
  exception when insufficient_privilege then null;
  end;
end;
$$;
-- Even a correctly shaped owner claim cannot bypass the server-side UID mapping.
set local request.jwt.claims = '{"iss":"https://securetoken.google.com/fictional-project","aud":"fictional-project","sub":"fictional-firebase-f","role":"authenticated","email_verified":true,"app_owner_id":"00000000-0000-4000-8000-00000000e001"}';
do $$ begin if public.current_app_owner() is not null then raise exception 'Forged mapping accepted'; end if; end; $$;
set local request.jwt.claims = '{"iss":"https://securetoken.google.com/foreign-project","aud":"foreign-project","sub":"fictional-firebase-e","role":"authenticated","email_verified":true,"app_owner_id":"00000000-0000-4000-8000-00000000e001"}';
do $$ begin if public.current_app_owner() is not null then raise exception 'Foreign Firebase project accepted'; end if; end; $$;
set local request.jwt.claims = '{"iss":"https://securetoken.google.com/fictional-project","aud":"fictional-project","sub":"fictional-firebase-e","role":"authenticated","app_owner_id":"00000000-0000-4000-8000-00000000e001"}';
do $$ begin if public.current_app_owner() is not null then raise exception 'Unverified email accepted'; end if; end; $$;
set local request.jwt.claims = '{"iss":"https://securetoken.google.com/fictional-project","aud":"fictional-project","sub":"fictional-firebase-e","email_verified":true,"app_owner_id":"00000000-0000-4000-8000-00000000e001"}';
do $$ begin if public.current_app_owner() is not null then raise exception 'Missing role accepted'; end if; end; $$;
set local request.jwt.claims = '{"iss":"https://securetoken.google.com/fictional-project","aud":"fictional-project","sub":"fictional-firebase-e","role":"authenticated","email_verified":true}';
do $$ begin if public.current_app_owner() is not null then raise exception 'Missing owner claim accepted'; end if; end; $$;
set local request.jwt.claims = '{"iss":"https://securetoken.google.com/fictional-project","aud":"fictional-project","sub":"unmapped-user","role":"authenticated","email_verified":true,"app_owner_id":"00000000-0000-4000-8000-00000000e001"}';
do $$ begin if public.current_app_owner() is not null then raise exception 'Unmapped UID accepted'; end if; end; $$;
rollback;
-- Only these known fictional fixtures exist in the disposable CI database.
delete from app_private.app_users where id='00000000-0000-4000-8000-00000000a101';
delete from auth.users where id='00000000-0000-4000-8000-00000000a101';
select 'PASS: Firebase owner mapping, owner operations, cross-owner denial, foreign project and forged claim rejection; fixtures rolled back' as result;
