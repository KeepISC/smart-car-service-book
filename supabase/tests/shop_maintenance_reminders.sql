-- Task 7.8 only. Fictional fixtures, rolled back on a disposable database.
begin;
update app_private.firebase_config set project_id = 'fictional-project';
insert into app_private.app_users(id) select ('00000000-0000-4000-8000-00000000' || n)::uuid from generate_series(7801,7804) n;
insert into app_private.firebase_identities(firebase_uid, owner_id)
  select 'fictional-reminder-' || n, ('00000000-0000-4000-8000-00000000' || n)::uuid from generate_series(7801,7804) n;
insert into app_private.firebase_provisioning_approvals(firebase_uid) select 'fictional-reminder-' || n from generate_series(7801,7804) n;
insert into app_private.repair_shops(id,name,subscription_status,subscription_starts_at,subscription_ends_at)
  values ('00000000-0000-4000-8000-000000007805','Fictional reminder shop','active',clock_timestamp()-interval '1 day',clock_timestamp()+interval '30 days');
insert into app_private.repair_shop_staff(shop_id,user_id,role,active) values
  ('00000000-0000-4000-8000-000000007805','00000000-0000-4000-8000-000000007802','admin',true),
  ('00000000-0000-4000-8000-000000007805','00000000-0000-4000-8000-000000007803','mechanic',true);
insert into public.vehicles(id,owner_id,type,make,model,year,engine,mileage) values
  ('00000000-0000-4000-8000-000000007811','00000000-0000-4000-8000-000000007801','car','Fictional','Reminder',2020,'Example',10000);
insert into public.vehicle_maintenance_items(id,vehicle_id,name,interval_km,enabled,history_status,last_completed_mileage)
  select ('00000000-0000-4000-8000-00000000' || n)::uuid,'00000000-0000-4000-8000-000000007811','Fictional operation ' || n,
    case when n=7823 then 20000 when n=7822 then 11000 else 10000 end,true,'known',0 from generate_series(7821,7826) n;
insert into app_private.vehicle_shop_authorizations(id,shop_id,vehicle_id,ownership_epoch,initiated_by,status,approved_by,approved_at,can_create_records)
  select '00000000-0000-4000-8000-000000007830','00000000-0000-4000-8000-000000007805',v.id,v.ownership_epoch,'owner','approved',v.owner_id,clock_timestamp(),false
  from public.vehicles v where v.id='00000000-0000-4000-8000-000000007811';
create function pg_temp.reminder_actor(n integer) returns void language sql as $$
  select set_config('request.jwt.claims',jsonb_build_object('iss','https://securetoken.google.com/fictional-project','aud','fictional-project',
    'sub','fictional-reminder-' || n,'role','authenticated','email_verified',true,'app_owner_id','00000000-0000-4000-8000-00000000' || n)::text,true)::void;
$$;
create function pg_temp.expect_error(statement text, expected text) returns void language plpgsql as $$
begin
  begin execute statement; exception when others then if sqlstate = expected then return; else raise; end if; end;
  raise exception 'Expected error % for %', expected, statement;
end;
$$;
create function pg_temp.send_reminder(n integer default 7821) returns uuid language sql as $$
  select public.send_shop_maintenance_reminder('00000000-0000-4000-8000-000000007805','00000000-0000-4000-8000-000000007811',('00000000-0000-4000-8000-00000000' || n)::uuid);
$$;
do $$ begin
  if not (select relrowsecurity and relforcerowsecurity from pg_class where oid='app_private.shop_maintenance_reminders'::regclass)
    or has_table_privilege('authenticated','app_private.shop_maintenance_reminders','select')
    or has_function_privilege('anon','public.send_shop_maintenance_reminder(uuid,uuid,uuid)','execute')
    or has_function_privilege('authenticated','app_private.shop_reminder_is_due(uuid,uuid)','execute') then raise exception 'Reminder grants/RLS are unsafe'; end if;
end; $$;
set local role authenticated;
select pg_temp.reminder_actor(7804);
select pg_temp.expect_error('select pg_temp.send_reminder()', '42501');
select pg_temp.reminder_actor(7802);
select pg_temp.expect_error('select pg_temp.send_reminder(7823)', '23514');
select pg_temp.expect_error('select pg_temp.send_reminder(7899)', '42501');
select pg_temp.send_reminder();
select pg_temp.expect_error('select pg_temp.send_reminder()', 'P0001');
select pg_temp.reminder_actor(7803);
select pg_temp.send_reminder(7822);
do $$ begin if public.list_shop_maintenance_reminders() <> '[]'::jsonb then raise exception 'Sender read customer inbox'; end if; end; $$;
reset role;
create temp table reminder_test_ids as select id from app_private.shop_maintenance_reminders;
grant select on reminder_test_ids to authenticated;
set local role authenticated;
select pg_temp.expect_error('select public.set_shop_maintenance_reminder_state((select id from reminder_test_ids limit 1),''read'')','42501');
select pg_temp.reminder_actor(7804);
select pg_temp.expect_error('select public.set_shop_maintenance_reminder_state((select id from reminder_test_ids limit 1),''dismissed'')','42501');
select pg_temp.reminder_actor(7801);
do $$ declare rows jsonb := public.list_shop_maintenance_reminders(); reminder uuid; begin
  if jsonb_array_length(rows) <> 2 or rows->0->>'shop_name' <> 'Fictional reminder shop' or rows->0 ? 'sender_id' or rows->0 ? 'owner_id' then raise exception 'Wrong recipient projection'; end if;
  reminder := (rows->0->>'id')::uuid;
  perform public.set_shop_maintenance_reminder_state(reminder,'read');
  if not exists(select 1 from jsonb_array_elements(public.list_shop_maintenance_reminders()) r where r->>'id'=reminder::text and r->>'read_at' is not null) then raise exception 'Read state not persisted'; end if;
  perform public.set_shop_maintenance_reminder_state(reminder,'dismissed');
  if jsonb_array_length(public.list_shop_maintenance_reminders()) <> 1 then raise exception 'Dismissal failed'; end if;
end; $$;
select pg_temp.reminder_actor(7802);
select pg_temp.expect_error('select pg_temp.send_reminder(7822)', 'P0001');
select pg_temp.send_reminder(7824);
select pg_temp.expect_error('select pg_temp.send_reminder(7825)', 'P0001');
reset role;
-- Shop-wide cap applies to a different vehicle with no per-vehicle quota used.
insert into app_private.shop_maintenance_reminders(vehicle_id,shop_id,maintenance_item_id,owner_id,ownership_epoch,sender_id)
  select '00000000-0000-4000-8000-000000007811','00000000-0000-4000-8000-000000007805','00000000-0000-4000-8000-000000007821',
    '00000000-0000-4000-8000-000000007801',v.ownership_epoch,'00000000-0000-4000-8000-000000007802'
    from public.vehicles v cross join generate_series(1,47) n where v.id='00000000-0000-4000-8000-000000007811';
insert into public.vehicles(id,owner_id,type,make,model,year,engine,mileage) values
  ('00000000-0000-4000-8000-000000007812','00000000-0000-4000-8000-000000007801','car','Fictional','Second reminder',2020,'Example',10000);
insert into public.vehicle_maintenance_items(id,vehicle_id,name,interval_km,enabled,history_status,last_completed_mileage) values
  ('00000000-0000-4000-8000-000000007827','00000000-0000-4000-8000-000000007812','Fictional second oil',10000,true,'known',0);
insert into app_private.vehicle_shop_authorizations(shop_id,vehicle_id,ownership_epoch,initiated_by,status,approved_by,approved_at)
  select '00000000-0000-4000-8000-000000007805',v.id,v.ownership_epoch,'owner','approved',v.owner_id,clock_timestamp() from public.vehicles v where v.id='00000000-0000-4000-8000-000000007812';
set local role authenticated;
select pg_temp.expect_error($q$select public.send_shop_maintenance_reminder('00000000-0000-4000-8000-000000007805','00000000-0000-4000-8000-000000007812','00000000-0000-4000-8000-000000007827')$q$, 'P0001');
reset role;
-- Real entitlement/staff/grant checks, each in isolation from rate limits.
update app_private.repair_shops set suspended=true where id='00000000-0000-4000-8000-000000007805';
set local role authenticated;
select pg_temp.expect_error('select pg_temp.send_reminder(7825)', '42501');
reset role;
update app_private.repair_shops set suspended=false,subscription_ends_at=clock_timestamp()-interval '1 second' where id='00000000-0000-4000-8000-000000007805';
set local role authenticated;
select pg_temp.expect_error('select pg_temp.send_reminder(7825)', '42501');
reset role;
update app_private.repair_shops set subscription_ends_at=clock_timestamp()+interval '1 day' where id='00000000-0000-4000-8000-000000007805';
update app_private.repair_shop_staff set active=false where user_id='00000000-0000-4000-8000-000000007802';
set local role authenticated;
select pg_temp.expect_error('select pg_temp.send_reminder(7825)', '42501');
reset role;
update app_private.repair_shop_staff set active=true where user_id='00000000-0000-4000-8000-000000007802';
update app_private.vehicle_shop_authorizations set status='revoked',revoked_at=clock_timestamp() where id='00000000-0000-4000-8000-000000007830';
set local role authenticated;
select pg_temp.expect_error('select pg_temp.send_reminder(7825)', '42501');
reset role;
-- Transfer boundary: old owner, new owner, and transfer-back cannot read old messages.
update public.vehicles set owner_id='00000000-0000-4000-8000-000000007804',ownership_epoch=ownership_epoch+1 where id='00000000-0000-4000-8000-000000007811';
set local role authenticated;
select pg_temp.reminder_actor(7801);
do $$ begin if public.list_shop_maintenance_reminders()<>'[]'::jsonb then raise exception 'Previous owner retained reminders'; end if; end; $$;
select pg_temp.expect_error('select public.set_shop_maintenance_reminder_state((select id from reminder_test_ids limit 1),''read'')','42501');
select pg_temp.reminder_actor(7804);
do $$ begin if public.list_shop_maintenance_reminders()<>'[]'::jsonb then raise exception 'New owner received old reminders'; end if; end; $$;
select pg_temp.expect_error('select public.set_shop_maintenance_reminder_state((select id from reminder_test_ids limit 1),''read'')','42501');
reset role;
update public.vehicles set owner_id='00000000-0000-4000-8000-000000007801',ownership_epoch=ownership_epoch+1 where id='00000000-0000-4000-8000-000000007811';
set local role authenticated;
select pg_temp.reminder_actor(7801);
do $$ begin if public.list_shop_maintenance_reminders()<>'[]'::jsonb then raise exception 'Transfer back restored reminders'; end if; end; $$;
select pg_temp.expect_error('select public.set_shop_maintenance_reminder_state((select id from reminder_test_ids limit 1),''read'')','42501');
reset role;
rollback;
select 'Task 7.8 reminder security PASS' result;
