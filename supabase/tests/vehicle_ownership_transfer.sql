-- Fictional fixtures and simulated claims; disposable PostgreSQL only.
begin;
update app_private.firebase_config set project_id = 'fictional-project' where singleton;
insert into app_private.app_users(id) values
  ('00000000-0000-4000-8000-000000006101'), ('00000000-0000-4000-8000-000000006102');
insert into app_private.firebase_identities(firebase_uid, owner_id) values
  ('fictional-transfer-a', '00000000-0000-4000-8000-000000006101'),
  ('fictional-transfer-b', '00000000-0000-4000-8000-000000006102');
insert into app_private.firebase_provisioning_approvals(firebase_uid) values
  ('fictional-transfer-a'), ('fictional-transfer-b');
insert into public.vehicles(id, owner_id, type, make, model, year, engine, mileage, license_plate) values
  ('00000000-0000-4000-8000-000000006103', '00000000-0000-4000-8000-000000006101', 'car', 'Fictional', 'Transfer', 2020, 'Example', 20000, 'PRIVATE-PLATE'),
  ('00000000-0000-4000-8000-000000006104', '00000000-0000-4000-8000-000000006101', 'car', 'Fictional', 'Other', 2020, 'Example', 20000, null);
insert into public.vehicle_maintenance_items(id,vehicle_id,name,interval_km,interval_months,history_status,last_completed_mileage) values
  ('00000000-0000-4000-8000-000000006105','00000000-0000-4000-8000-000000006103','Oil',10000,12,'known',10000);
insert into public.service_visits(id,vehicle_id,service_date,mileage,service_type,workshop_name,total_cost,notes) values
  ('00000000-0000-4000-8000-000000006106','00000000-0000-4000-8000-000000006103','2026-01-31',18000,'workshop','Private shop',123,'Private notes'),
  ('00000000-0000-4000-8000-000000006107','00000000-0000-4000-8000-000000006103','2025-01-01',12000,'diy',null,25,'Shared notes');
insert into public.service_operations(service_visit_id,maintenance_item_id,operation_name,cost,next_interval_km,next_interval_months) values
  ('00000000-0000-4000-8000-000000006106','00000000-0000-4000-8000-000000006105','Private operation',123,5000,2),
  ('00000000-0000-4000-8000-000000006106',null,'Private custom operation',2,null,null),
  ('00000000-0000-4000-8000-000000006107',null,'Shared operation',25,null,null);
update public.vehicles set mileage=21000 where id='00000000-0000-4000-8000-000000006103';
create temp table transfer_state(name text primary key, invitation jsonb);
grant select, insert, update on transfer_state to authenticated;
create function pg_temp.check_true(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception '%', message; end if; end; $$;
create function pg_temp.expect_error(command text, expected text default '42501') returns void language plpgsql as $$
begin
  begin execute command;
  exception when others then
    if sqlstate = expected then return; end if;
    raise;
  end;
  raise exception 'Expected % for %', expected, command;
end; $$;

select pg_temp.check_true((select bool_and(relrowsecurity and relforcerowsecurity) from pg_class
  where oid in ('app_private.vehicle_transfer_invitations'::regclass,'app_private.transfer_private_service_history'::regclass)), 'Forced RLS missing');
select pg_temp.check_true(not has_function_privilege('anon','public.accept_vehicle_transfer(text)','execute')
  and not has_function_privilege('authenticated','app_private.lock_vehicle_transfer(text)','execute')
  and not has_table_privilege('authenticated','app_private.vehicle_transfer_invitations','select')
  and not has_table_privilege('authenticated','app_private.transfer_private_service_history','select'), 'Unexpected privileges');
set local role authenticated;
set local request.jwt.claims = '{"iss":"https://securetoken.google.com/fictional-project","aud":"fictional-project","sub":"fictional-transfer-a","role":"authenticated","email_verified":true,"app_owner_id":"00000000-0000-4000-8000-000000006101"}';
select pg_temp.expect_error($q$update public.vehicles set owner_id='00000000-0000-4000-8000-000000006102'$q$);
select pg_temp.expect_error($q$update public.vehicles set ownership_epoch=100$q$);
select pg_temp.expect_error($q$update public.service_visits set private_on_transfer=true$q$);
select pg_temp.expect_error($q$select public.create_vehicle_transfer('00000000-0000-4000-8000-000000006103',clock_timestamp()+interval '8 days')$q$,'22023');
select pg_temp.expect_error($q$select public.create_vehicle_transfer('00000000-0000-4000-8000-000000006103',clock_timestamp()-interval '1 second')$q$,'22023');
select pg_temp.expect_error($q$select public.set_service_visit_transfer_privacy('00000000-0000-4000-8000-000000006104','00000000-0000-4000-8000-000000006106',true)$q$);
select public.set_service_visit_transfer_privacy('00000000-0000-4000-8000-000000006103','00000000-0000-4000-8000-000000006106',true);
select public.set_service_visit_transfer_privacy('00000000-0000-4000-8000-000000006103','00000000-0000-4000-8000-000000006106',false);
select public.set_service_visit_transfer_privacy('00000000-0000-4000-8000-000000006103','00000000-0000-4000-8000-000000006106',true);
insert into transfer_state values ('old', public.create_vehicle_transfer('00000000-0000-4000-8000-000000006103'));
insert into transfer_state values ('current', public.create_vehicle_transfer('00000000-0000-4000-8000-000000006103'));
select pg_temp.expect_error(format('select public.accept_vehicle_transfer(%L)',(select invitation->>'token' from transfer_state where name='current')));
select pg_temp.check_true((select notes='Private notes' from public.service_visits where id='00000000-0000-4000-8000-000000006106'),'Privacy choice hid content prematurely');
reset role;
select pg_temp.check_true((select i.token_hash=sha256(convert_to(s.invitation->>'token','UTF8'))
  from app_private.vehicle_transfer_invitations i join transfer_state s on i.id=(s.invitation->>'id')::uuid where s.name='current'), 'Token hash mismatch');
set local role authenticated;
set local request.jwt.claims = '{"iss":"https://securetoken.google.com/fictional-project","aud":"fictional-project","sub":"fictional-transfer-b","role":"authenticated","email_verified":true,"app_owner_id":"00000000-0000-4000-8000-000000006102"}';
select pg_temp.expect_error($q$select public.create_vehicle_transfer('00000000-0000-4000-8000-000000006103')$q$);
select pg_temp.expect_error($q$select public.set_service_visit_transfer_privacy('00000000-0000-4000-8000-000000006103','00000000-0000-4000-8000-000000006106',false)$q$);
select pg_temp.expect_error(format('select public.revoke_vehicle_transfer(%L,%L)','00000000-0000-4000-8000-000000006103',(select invitation->>'id' from transfer_state where name='current')));
select pg_temp.expect_error($q$select public.preview_vehicle_transfer('bad')$q$);
select pg_temp.expect_error(format('select public.preview_vehicle_transfer(%L)',repeat('a',64)));
select pg_temp.expect_error(format('select public.accept_vehicle_transfer(%L)',(select invitation->>'token' from transfer_state where name='old')));
select pg_temp.check_true(not exists(select 1 from public.vehicles where id='00000000-0000-4000-8000-000000006103')
  and not exists(select 1 from public.service_visits), 'Preview granted table access');
select pg_temp.check_true((select public.preview_vehicle_transfer(invitation->>'token')->'vehicle'->>'mileage'='21000'
  and not (public.preview_vehicle_transfer(invitation->>'token')->'vehicle' ? 'license_plate')
  and not (public.preview_vehicle_transfer(invitation->>'token')->'vehicle' ? 'owner_id') from transfer_state where name='current'), 'Preview disclosure');

-- Force failure after redaction, ownership change and epoch advancement.
reset role;
create function pg_temp.fail_transfer() returns trigger language plpgsql as $$
begin if new.status='accepted' then raise check_violation; end if; return new; end; $$;
create trigger fictional_transfer_failure before update on app_private.vehicle_transfer_invitations
  for each row execute function pg_temp.fail_transfer();
set local role authenticated;
select pg_temp.expect_error(format('select public.accept_vehicle_transfer(%L)',(select invitation->>'token' from transfer_state where name='current')),'23514');
reset role;
select pg_temp.check_true((select owner_id='00000000-0000-4000-8000-000000006101' and ownership_epoch=0 from public.vehicles where id='00000000-0000-4000-8000-000000006103')
  and (select notes='Private notes' from public.service_visits where id='00000000-0000-4000-8000-000000006106')
  and not exists(select 1 from app_private.transfer_private_service_history), 'Transfer rollback was incomplete');
drop trigger fictional_transfer_failure on app_private.vehicle_transfer_invitations;
set local role authenticated;
select public.accept_vehicle_transfer(invitation->>'token') from transfer_state where name='current';
select pg_temp.check_true((select ownership_epoch=1 and mileage=21000 from public.vehicles where id='00000000-0000-4000-8000-000000006103')
  and (select count(*)=1 from public.vehicle_mileage_history)
  and (select interval_km=10000 and interval_months=12 and last_completed_mileage=10000 from public.vehicle_maintenance_items), 'Schedules or mileage changed');
select pg_temp.check_true((select service_date='2026-01-31' and mileage=18000 and workshop_name is null and total_cost is null and notes is null
  from public.service_visits where id='00000000-0000-4000-8000-000000006106')
  and (select count(*)=2 and bool_and(cost is null and operation_name='Private maintenance completion') from public.service_operations where service_visit_id='00000000-0000-4000-8000-000000006106')
  and (select next_interval_km=5000 and next_interval_months=2 from public.service_operations where maintenance_item_id='00000000-0000-4000-8000-000000006105')
  and (select notes='Shared notes' and total_cost=25 from public.service_visits where id='00000000-0000-4000-8000-000000006107'), 'Redaction or retained completion facts incorrect');
select pg_temp.expect_error(format('select public.accept_vehicle_transfer(%L)',(select invitation->>'token' from transfer_state where name='current')));
select pg_temp.expect_error(format('select public.decline_vehicle_transfer(%L)',(select invitation->>'token' from transfer_state where name='current')));
select pg_temp.expect_error($q$update public.vehicles set mileage=17000 where id='00000000-0000-4000-8000-000000006103'$q$,'23514');
select pg_temp.expect_error($q$select * from app_private.transfer_private_service_history$q$);
reset role;
select pg_temp.check_true((select original_visit->>'notes'='Private notes' and original_operations @> '[{"operation_name":"Private operation"}]'::jsonb
  from app_private.transfer_private_service_history), 'Private archive missing');
set local role authenticated;
set local request.jwt.claims = '{"iss":"https://securetoken.google.com/fictional-project","aud":"fictional-project","sub":"fictional-transfer-a","role":"authenticated","email_verified":true,"app_owner_id":"00000000-0000-4000-8000-000000006101"}';
select pg_temp.check_true(not exists(select 1 from public.vehicles where id='00000000-0000-4000-8000-000000006103')
  and not exists(select 1 from public.vehicle_maintenance_items) and not exists(select 1 from public.service_visits)
  and not exists(select 1 from public.service_operations) and not exists(select 1 from public.vehicle_mileage_history), 'Former owner access survived');
select pg_temp.expect_error($q$select public.update_vehicle_mileage('00000000-0000-4000-8000-000000006103',22000)$q$);
select pg_temp.expect_error($q$select public.delete_service_visit('00000000-0000-4000-8000-000000006103','00000000-0000-4000-8000-000000006106')$q$);
select pg_temp.expect_error($q$select public.delete_vehicle_maintenance_item('00000000-0000-4000-8000-000000006103','00000000-0000-4000-8000-000000006105')$q$);

-- Returning to an earlier owner must advance the epoch and cannot revive tokens.
set local request.jwt.claims = '{"iss":"https://securetoken.google.com/fictional-project","aud":"fictional-project","sub":"fictional-transfer-b","role":"authenticated","email_verified":true,"app_owner_id":"00000000-0000-4000-8000-000000006102"}';
insert into transfer_state values ('return', public.create_vehicle_transfer('00000000-0000-4000-8000-000000006103'));
set local request.jwt.claims = '{"iss":"https://securetoken.google.com/fictional-project","aud":"fictional-project","sub":"fictional-transfer-a","role":"authenticated","email_verified":false,"app_owner_id":"00000000-0000-4000-8000-000000006101"}';
select pg_temp.expect_error(format('select public.preview_vehicle_transfer(%L)',(select invitation->>'token' from transfer_state where name='return')));
set local request.jwt.claims = '{"iss":"https://securetoken.google.com/fictional-project","aud":"fictional-project","sub":"fictional-transfer-a","role":"authenticated","email_verified":true,"app_owner_id":"00000000-0000-4000-8000-000000006101"}';
select public.accept_vehicle_transfer(invitation->>'token') from transfer_state where name='return';
select pg_temp.check_true((select ownership_epoch=2 from public.vehicles where id='00000000-0000-4000-8000-000000006103')
  and (select notes is null from public.service_visits where id='00000000-0000-4000-8000-000000006106'), 'Return transfer restored access to private content or old epoch');
select pg_temp.expect_error(format('select public.accept_vehicle_transfer(%L)',(select invitation->>'token' from transfer_state where name='current')));

-- Revoke, decline and expiry consume/disable invitations without changing ownership.
insert into transfer_state values ('revoke',public.create_vehicle_transfer('00000000-0000-4000-8000-000000006104'));
select public.revoke_vehicle_transfer('00000000-0000-4000-8000-000000006104',(invitation->>'id')::uuid) from transfer_state where name='revoke';
insert into transfer_state values ('decline',public.create_vehicle_transfer('00000000-0000-4000-8000-000000006104'));
set local request.jwt.claims = '{"iss":"https://securetoken.google.com/fictional-project","aud":"fictional-project","sub":"fictional-transfer-b","role":"authenticated","email_verified":true,"app_owner_id":"00000000-0000-4000-8000-000000006102"}';
select pg_temp.expect_error(format('select public.accept_vehicle_transfer(%L)',(select invitation->>'token' from transfer_state where name='revoke')));
select public.decline_vehicle_transfer(invitation->>'token') from transfer_state where name='decline';
select pg_temp.expect_error(format('select public.accept_vehicle_transfer(%L)',(select invitation->>'token' from transfer_state where name='decline')));
reset role;
insert into transfer_state values ('expired',jsonb_build_object('token',repeat('b',64)));
insert into app_private.vehicle_transfer_invitations(vehicle_id,sender_id,ownership_epoch,token_hash,created_at,expires_at)
  values ('00000000-0000-4000-8000-000000006104','00000000-0000-4000-8000-000000006101',0,sha256(convert_to(repeat('b',64),'UTF8')),clock_timestamp()-interval '2 days',clock_timestamp()-interval '1 day');
set local role authenticated;
select pg_temp.expect_error(format('select public.preview_vehicle_transfer(%L)',(select invitation->>'token' from transfer_state where name='expired')));
-- Forged/disabled/unverified identities cannot exercise the bearer capability.
set local request.jwt.claims = '{"iss":"https://securetoken.google.com/fictional-project","aud":"fictional-project","sub":"fictional-transfer-b","role":"authenticated","email_verified":true,"app_owner_id":"00000000-0000-4000-8000-000000006101"}';
select pg_temp.expect_error($q$select public.create_vehicle_transfer('00000000-0000-4000-8000-000000006104')$q$);
reset role;
update app_private.firebase_provisioning_approvals set enabled=false where firebase_uid='fictional-transfer-a';
set local role authenticated;
set local request.jwt.claims = '{"iss":"https://securetoken.google.com/fictional-project","aud":"fictional-project","sub":"fictional-transfer-a","role":"authenticated","email_verified":true,"app_owner_id":"00000000-0000-4000-8000-000000006101"}';
select pg_temp.expect_error($q$select public.create_vehicle_transfer('00000000-0000-4000-8000-000000006103')$q$);
set local role anon;
select pg_temp.expect_error($q$select public.accept_vehicle_transfer('bad')$q$);
rollback;
select 'PASS: ownership transfer RLS, hashing, preview, privacy, preservation, replay, revoke, decline, expiry, identity boundaries and atomic rollback' as result;
