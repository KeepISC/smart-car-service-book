-- Task 6.4 regression only; fictional data in disposable PostgreSQL.
begin;
update app_private.firebase_config set project_id='fictional-project';
insert into app_private.app_users(id) values
  ('00000000-0000-4000-8000-000000006401'),('00000000-0000-4000-8000-000000006402');
insert into app_private.firebase_identities(firebase_uid,owner_id) values
  ('fictional-integration-a','00000000-0000-4000-8000-000000006401'),
  ('fictional-integration-b','00000000-0000-4000-8000-000000006402');
insert into app_private.firebase_provisioning_approvals(firebase_uid) values ('fictional-integration-a'),('fictional-integration-b');
insert into public.vehicles(id,owner_id,type,make,model,year,engine,mileage,license_plate) values
  ('00000000-0000-4000-8000-000000006403','00000000-0000-4000-8000-000000006401','car','Fictional','Preview',2020,'Example',30000,'SECRET PLATE');
insert into public.vehicle_maintenance_items(id,vehicle_id,name,interval_km,interval_months) values
  ('00000000-0000-4000-8000-000000006404','00000000-0000-4000-8000-000000006403','SECRET SCHEDULE NAME',10000,12);
insert into public.service_visits(id,vehicle_id,service_date,mileage,service_type,notes,workshop_name,total_cost,private_on_transfer) values
  ('00000000-0000-4000-8000-000000006405','00000000-0000-4000-8000-000000006403','2026-01-31',25000,'workshop','SECRET PRIVATE NOTES','SECRET PRIVATE SHOP',12345,true),
  ('00000000-0000-4000-8000-000000006406','00000000-0000-4000-8000-000000006403','2025-01-01',20000,'workshop','SECRET SHARED NOTES','SECRET SHARED SHOP',6789,false);
insert into public.service_operations(service_visit_id,maintenance_item_id,operation_name,cost,next_interval_km,next_interval_months) values
  ('00000000-0000-4000-8000-000000006405','00000000-0000-4000-8000-000000006404','SECRET PRIVATE OPERATION',12345,5000,2),
  ('00000000-0000-4000-8000-000000006406',null,'SECRET SHARED OPERATION',6789,null,null);
create temp table integration_invite(invitation jsonb);
grant select,insert on integration_invite to authenticated;
set local role authenticated;
set local request.jwt.claims = '{"iss":"https://securetoken.google.com/fictional-project","aud":"fictional-project","sub":"fictional-integration-a","role":"authenticated","email_verified":true,"app_owner_id":"00000000-0000-4000-8000-000000006401"}';
insert into integration_invite select public.create_vehicle_transfer('00000000-0000-4000-8000-000000006403');
do $$ begin
  if public.vehicle_transfer_status('00000000-0000-4000-8000-000000006403',(select (invitation->>'id')::uuid from integration_invite)) <> 'pending'
    then raise exception 'Pending status missing'; end if;
end; $$;
set local request.jwt.claims = '{"iss":"https://securetoken.google.com/fictional-project","aud":"fictional-project","sub":"fictional-integration-b","role":"authenticated","email_verified":true,"app_owner_id":"00000000-0000-4000-8000-000000006402"}';
do $$
declare preview jsonb;
begin
  preview := public.preview_vehicle_transfer((select invitation->>'token' from integration_invite));
  if preview::text like '%SECRET%' or preview::text like '%00000000-0000-4000-8000-000000006401%'
    or preview::text like '%token%' or preview::text like '%owner_id%' or preview::text like '%cost%'
    then raise exception 'Sensitive preview content disclosed'; end if;
  if jsonb_array_length(preview->'maintenance_records') <> 2 or jsonb_array_length(preview->'maintenance_schedules') <> 1
    or preview->'maintenance_records'->0->>'service_date' <> '2026-01-31'
    or preview->'maintenance_records'->0->>'mileage' <> '25000'
    or preview->'maintenance_records'->0->'operations'->0->>'next_interval_km' <> '5000'
    or preview->'maintenance_schedules'->0->>'interval_months' <> '12'
    then raise exception 'Completion or schedule facts missing'; end if;
  if exists(select 1 from public.vehicles where id='00000000-0000-4000-8000-000000006403')
    or exists(select 1 from public.service_visits where vehicle_id='00000000-0000-4000-8000-000000006403')
    then raise exception 'Preview granted table access'; end if;
  begin
    perform public.vehicle_transfer_status('00000000-0000-4000-8000-000000006403',(select (invitation->>'id')::uuid from integration_invite));
    raise exception 'Non-sender accessed status';
  exception when insufficient_privilege then null; end;
end; $$;
select public.accept_vehicle_transfer(invitation->>'token') from integration_invite;
do $$ begin
  if (select ownership_epoch from public.vehicles where id='00000000-0000-4000-8000-000000006403') <> 1
    then raise exception 'Shop epoch was not invalidated'; end if;
  begin
    perform public.preview_vehicle_transfer((select invitation->>'token' from integration_invite));
    raise exception 'Consumed preview accepted';
  exception when insufficient_privilege then null; end;
end; $$;
set local request.jwt.claims = '{"iss":"https://securetoken.google.com/fictional-project","aud":"fictional-project","sub":"fictional-integration-a","role":"authenticated","email_verified":true,"app_owner_id":"00000000-0000-4000-8000-000000006401"}';
do $$ begin
  if public.vehicle_transfer_status('00000000-0000-4000-8000-000000006403',(select (invitation->>'id')::uuid from integration_invite)) <> 'accepted'
    or exists(select 1 from public.vehicles where id='00000000-0000-4000-8000-000000006403')
    then raise exception 'Outcome status leaked vehicle access or failed'; end if;
end; $$;
reset role;
do $$ begin
  if has_function_privilege('anon','public.vehicle_transfer_status(uuid,uuid)','execute')
    then raise exception 'Anonymous status granted'; end if;
end; $$;
rollback;
select 'PASS: sanitized preview, private/shared text exclusion, fact preservation, owner isolation, outcome status, consumed preview and shop epoch' as result;
