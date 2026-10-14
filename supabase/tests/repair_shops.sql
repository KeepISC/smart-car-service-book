-- Fictional identities only; run on disposable local PostgreSQL, never Supabase.
begin;
update app_private.firebase_config set project_id = 'fictional-project';
insert into app_private.app_users(id) values
  ('00000000-0000-4000-8000-000000007101'), ('00000000-0000-4000-8000-000000007102'),
  ('00000000-0000-4000-8000-000000007103'), ('00000000-0000-4000-8000-000000007104');
insert into app_private.firebase_identities(firebase_uid, owner_id)
  select 'fictional-shop-' || right(id::text, 4), id from app_private.app_users
    where id::text like '00000000-0000-4000-8000-00000000710%';
insert into app_private.firebase_provisioning_approvals(firebase_uid)
  select firebase_uid from app_private.firebase_identities where firebase_uid like 'fictional-shop-%';
insert into public.vehicles(id, owner_id, type, make, model, year, engine, mileage, license_plate, vin) values
  ('00000000-0000-4000-8000-000000007111','00000000-0000-4000-8000-000000007101','car','Fictional','Customer',2020,'Example',30000,'SECRET PLATE','123456789ABCDEFGH'), -- gitleaks:allow fictional VIN for projection privacy checks
  ('00000000-0000-4000-8000-000000007112','00000000-0000-4000-8000-000000007104','car','Fictional','Other',2020,'Example',30000,null,null),
  ('00000000-0000-4000-8000-000000007113','00000000-0000-4000-8000-000000007102','car','Fictional','Personal',2020,'Example',30000,null,null);
insert into public.vehicle_maintenance_items(id, vehicle_id, name, interval_km, interval_months) values
  ('00000000-0000-4000-8000-000000007121','00000000-0000-4000-8000-000000007111','SECRET SCHEDULE',10000,12),
  ('00000000-0000-4000-8000-000000007122','00000000-0000-4000-8000-000000007112','Other',10000,12);
insert into public.service_visits(id,vehicle_id,service_date,mileage,service_type,notes,workshop_name,total_cost,private_on_transfer) values
  ('00000000-0000-4000-8000-000000007131','00000000-0000-4000-8000-000000007111','2026-01-31',25000,'workshop','SECRET PRIVATE','SECRET SHOP',100,true),
  ('00000000-0000-4000-8000-000000007132','00000000-0000-4000-8000-000000007111','2025-01-31',15000,'workshop','SECRET SHARED','SECRET SHOP',100,false);
insert into public.service_operations(service_visit_id,maintenance_item_id,operation_name,cost,next_interval_months) values
  ('00000000-0000-4000-8000-000000007131','00000000-0000-4000-8000-000000007121','SECRET OPERATION',100,2);
create temp table shop_test_state(key text primary key, value text);
grant select, insert, update on shop_test_state to authenticated;
create function pg_temp.shop_test_actor(p_suffix text) returns void language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('iss','https://securetoken.google.com/fictional-project',
    'aud','fictional-project','sub','fictional-shop-' || p_suffix,'role','authenticated','email_verified',true,
    'app_owner_id','00000000-0000-4000-8000-00000000' || p_suffix)::text, true)::void;
$$;
create function pg_temp.shop_test_id(p_key text) returns uuid language sql as $$
  select value::uuid from shop_test_state where key = p_key;
$$;
create function pg_temp.shop_test_denied(p_sql text) returns void language plpgsql as $$
begin
  begin execute p_sql; exception when insufficient_privilege then return; end;
  raise exception 'Unauthorized operation succeeded: %', p_sql;
end;
$$;
create function pg_temp.shop_test_invalid(p_sql text) returns void language plpgsql as $$
begin
  begin execute p_sql;
    exception when check_violation or invalid_parameter_value or invalid_text_representation or not_null_violation or unique_violation then return;
  end;
  raise exception 'Invalid mutation succeeded: %', p_sql;
end;
$$;

set local role authenticated;
select pg_temp.shop_test_actor('7102');
insert into shop_test_state values ('shop', public.create_repair_shop('Fictional repair shop')::text);
do $$ begin
  if jsonb_array_length(public.list_repair_shops()) <> 1
    or not exists (select 1 from public.vehicles where id='00000000-0000-4000-8000-000000007113') then
    raise exception 'Personal and shop roles did not coexist';
  end if;
end; $$;
select pg_temp.shop_test_invalid($q$select public.create_repair_shop(' ')$q$);
select pg_temp.shop_test_invalid($q$select public.set_repair_shop_staff(pg_temp.shop_test_id('shop'),'00000000-0000-4000-8000-000000007102','mechanic')$q$);
select pg_temp.shop_test_denied($q$select public.set_repair_shop_staff(pg_temp.shop_test_id('shop'),'00000000-0000-4000-8000-000000007104','admin')$q$);
insert into shop_test_state values ('grant', public.request_vehicle_shop_authorization('00000000-0000-4000-8000-000000007111',pg_temp.shop_test_id('shop'))::text);
select pg_temp.shop_test_denied($q$select public.get_repair_shop_vehicle(pg_temp.shop_test_id('shop'),'00000000-0000-4000-8000-000000007111')$q$);
select pg_temp.shop_test_denied($q$select public.approve_vehicle_shop_authorization('00000000-0000-4000-8000-000000007111',pg_temp.shop_test_id('grant'),true)$q$);

select pg_temp.shop_test_actor('7103');
select public.request_repair_shop_membership(pg_temp.shop_test_id('shop'));
select pg_temp.shop_test_denied($q$select public.list_repair_shop_staff(pg_temp.shop_test_id('shop'))$q$);
select pg_temp.shop_test_actor('7102');
select public.set_repair_shop_staff(pg_temp.shop_test_id('shop'),'00000000-0000-4000-8000-000000007103','mechanic');
select pg_temp.shop_test_actor('7103');
select pg_temp.shop_test_denied($q$select public.set_repair_shop_staff(pg_temp.shop_test_id('shop'),'00000000-0000-4000-8000-000000007103','admin')$q$);
select pg_temp.shop_test_denied($q$select public.request_vehicle_shop_authorization('00000000-0000-4000-8000-000000007112',pg_temp.shop_test_id('shop'))$q$);

select pg_temp.shop_test_actor('7101');
select public.approve_vehicle_shop_authorization('00000000-0000-4000-8000-000000007111',pg_temp.shop_test_id('grant'),false);
select pg_temp.shop_test_denied($q$select public.approve_vehicle_shop_authorization('00000000-0000-4000-8000-000000007111',pg_temp.shop_test_id('grant'),true)$q$);
select pg_temp.shop_test_actor('7103');
do $$ declare projection jsonb; begin
  projection := public.get_repair_shop_vehicle(pg_temp.shop_test_id('shop'),'00000000-0000-4000-8000-000000007111');
  if projection::text like '%SECRET%' or projection::text like '%owner_id%' or projection::text like '%license_plate%'
    or projection::text like '%vin%' or projection::text like '%cost%' or projection::text like '%notes%' then
    raise exception 'Customer private content leaked';
  end if;
  if projection->'vehicle'->>'mileage' <> '30000' or jsonb_array_length(projection->'maintenance_records') <> 2
    or projection->'maintenance_records'->0->'operations'->0->>'next_interval_months' <> '2' then
    raise exception 'Completion facts lost';
  end if;
  if exists (select 1 from public.vehicles where id='00000000-0000-4000-8000-000000007111')
    or exists (select 1 from public.service_visits where vehicle_id='00000000-0000-4000-8000-000000007111')
    or exists (select 1 from public.vehicle_maintenance_items where vehicle_id='00000000-0000-4000-8000-000000007111') then
    raise exception 'Shop gained direct table access';
  end if;
  update public.vehicles set model='Forbidden' where id='00000000-0000-4000-8000-000000007111';
  if found then raise exception 'Shop edited vehicle'; end if;
  delete from public.vehicles where id='00000000-0000-4000-8000-000000007111';
  if found then raise exception 'Shop deleted vehicle'; end if;
end; $$;
select pg_temp.shop_test_denied($q$select public.create_vehicle_transfer('00000000-0000-4000-8000-000000007111')$q$);
select pg_temp.shop_test_denied($q$select public.delete_service_visit('00000000-0000-4000-8000-000000007111','00000000-0000-4000-8000-000000007131')$q$);
select pg_temp.shop_test_denied($q$select public.save_service_visit('00000000-0000-4000-8000-000000007111','00000000-0000-4000-8000-000000007131','{}')$q$);
select pg_temp.shop_test_denied($q$select public.create_repair_shop_service_visit(pg_temp.shop_test_id('shop'),'00000000-0000-4000-8000-000000007111','{}')$q$);
select pg_temp.shop_test_actor('7104');
select pg_temp.shop_test_denied($q$select public.get_repair_shop_vehicle(pg_temp.shop_test_id('shop'),'00000000-0000-4000-8000-000000007111')$q$);
insert into shop_test_state values ('other_shop', public.create_repair_shop('Other fictional shop')::text);
select pg_temp.shop_test_denied($q$select public.get_repair_shop_vehicle(pg_temp.shop_test_id('other_shop'),'00000000-0000-4000-8000-000000007111')$q$);

select pg_temp.shop_test_actor('7101');
select public.revoke_vehicle_shop_authorization('00000000-0000-4000-8000-000000007111',pg_temp.shop_test_id('grant'));
update shop_test_state set value=public.request_vehicle_shop_authorization('00000000-0000-4000-8000-000000007111',pg_temp.shop_test_id('shop'))::text where key='grant';
-- Owner-initiated requests also require a separate explicit approval.
select pg_temp.shop_test_actor('7103');
select pg_temp.shop_test_denied($q$select public.get_repair_shop_vehicle(pg_temp.shop_test_id('shop'),'00000000-0000-4000-8000-000000007111')$q$);
select pg_temp.shop_test_actor('7101');
select public.approve_vehicle_shop_authorization('00000000-0000-4000-8000-000000007111',pg_temp.shop_test_id('grant'),true);
do $$ begin
  if public.list_vehicle_shop_authorizations('00000000-0000-4000-8000-000000007111')->0->>'shop_name' <> 'Fictional repair shop' then
    raise exception 'Owner cannot identify the shop requesting consent';
  end if;
end; $$;
select pg_temp.shop_test_actor('7103');
insert into shop_test_state values ('visit', public.create_repair_shop_service_visit(pg_temp.shop_test_id('shop'),
  '00000000-0000-4000-8000-000000007111','{"service_date":"2026-02-28","mileage":26000,"notes":"Fictional new work","operations":[{"operation_name":"Oil","maintenance_item_id":"00000000-0000-4000-8000-000000007121","cost":20}]}')::text);
select pg_temp.shop_test_denied($q$select public.create_repair_shop_service_visit(pg_temp.shop_test_id('shop'),'00000000-0000-4000-8000-000000007111','{"service_date":"2026-02-28","mileage":26000,"operations":[{"operation_name":"Foreign","maintenance_item_id":"00000000-0000-4000-8000-000000007122"}]}')$q$);
select pg_temp.shop_test_invalid($q$select public.create_repair_shop_service_visit(pg_temp.shop_test_id('shop'),'00000000-0000-4000-8000-000000007111','{"service_date":"2026-02-28","mileage":31000,"operations":[{"operation_name":"Above mileage"}]}')$q$);
select pg_temp.shop_test_invalid($q$select public.create_repair_shop_service_visit(pg_temp.shop_test_id('shop'),'00000000-0000-4000-8000-000000007111','{"service_date":"9999-12-31","mileage":26000,"operations":[{"operation_name":"Future"}]}')$q$);
select pg_temp.shop_test_invalid($q$select public.create_repair_shop_service_visit(pg_temp.shop_test_id('shop'),'00000000-0000-4000-8000-000000007111','{"service_date":"2026-02-28","mileage":26000,"operations":[{"operation_name":"Valid"},{"operation_name":" "}]}')$q$);
select pg_temp.shop_test_invalid($q$select public.create_repair_shop_service_visit(pg_temp.shop_test_id('shop'),'00000000-0000-4000-8000-000000007111','{"service_date":"2026-02-28","mileage":26000,"operations":[{"operation_name":"Override","next_interval_km":1}]}')$q$);
select pg_temp.shop_test_invalid($q$select public.create_repair_shop_service_visit(pg_temp.shop_test_id('shop'),'00000000-0000-4000-8000-000000007111','{"service_date":"2026-02-28","mileage":26000,"owner_id":"forged","operations":[{"operation_name":"Override"}]}')$q$);
select pg_temp.shop_test_invalid($q$select public.create_repair_shop_service_visit(pg_temp.shop_test_id('shop'),'00000000-0000-4000-8000-000000007111','{"service_date":"2026-02-28","mileage":26000,"total_cost":1.001,"operations":[{"operation_name":"Precision"}]}')$q$);
select pg_temp.shop_test_invalid($q$select public.create_repair_shop_service_visit(pg_temp.shop_test_id('shop'),'00000000-0000-4000-8000-000000007111','{"service_date":"2026-02-28","mileage":26000,"operations":[]}')$q$);
select pg_temp.shop_test_invalid($q$select public.create_repair_shop_service_visit(pg_temp.shop_test_id('shop'),'00000000-0000-4000-8000-000000007111','{"service_date":"2026-02-28","mileage":26000,"operations":[{"operation_name":"Duplicate","maintenance_item_id":"00000000-0000-4000-8000-000000007121"},{"operation_name":"Duplicate","maintenance_item_id":"00000000-0000-4000-8000-000000007121"}]}')$q$);

select pg_temp.shop_test_actor('7102');
select public.set_repair_shop_staff(pg_temp.shop_test_id('shop'),'00000000-0000-4000-8000-000000007103',null);
select pg_temp.shop_test_actor('7103');
select pg_temp.shop_test_denied($q$select public.get_repair_shop_vehicle(pg_temp.shop_test_id('shop'),'00000000-0000-4000-8000-000000007111')$q$);
select pg_temp.shop_test_denied($q$select public.create_repair_shop_service_visit(pg_temp.shop_test_id('shop'),'00000000-0000-4000-8000-000000007111','{}')$q$);
select public.request_repair_shop_membership(pg_temp.shop_test_id('shop'));
select pg_temp.shop_test_denied($q$select public.get_repair_shop_vehicle(pg_temp.shop_test_id('shop'),'00000000-0000-4000-8000-000000007111')$q$);
select pg_temp.shop_test_actor('7102');
select public.set_repair_shop_staff(pg_temp.shop_test_id('shop'),'00000000-0000-4000-8000-000000007103','mechanic');
select pg_temp.shop_test_actor('7101');
insert into shop_test_state values ('token', public.create_vehicle_transfer('00000000-0000-4000-8000-000000007111')->>'token');
select pg_temp.shop_test_actor('7104');
select public.accept_vehicle_transfer(value) from shop_test_state where key='token';
select pg_temp.shop_test_actor('7103');
select pg_temp.shop_test_denied($q$select public.get_repair_shop_vehicle(pg_temp.shop_test_id('shop'),'00000000-0000-4000-8000-000000007111')$q$);
select pg_temp.shop_test_actor('7101');
select pg_temp.shop_test_denied($q$select public.approve_vehicle_shop_authorization('00000000-0000-4000-8000-000000007111',pg_temp.shop_test_id('grant'),true)$q$);
select pg_temp.shop_test_actor('7104');
select pg_temp.shop_test_denied($q$select public.approve_vehicle_shop_authorization('00000000-0000-4000-8000-000000007111',pg_temp.shop_test_id('grant'),true)$q$);
insert into shop_test_state values ('new_grant',public.request_vehicle_shop_authorization('00000000-0000-4000-8000-000000007111',pg_temp.shop_test_id('shop'))::text);
select public.approve_vehicle_shop_authorization('00000000-0000-4000-8000-000000007111',pg_temp.shop_test_id('new_grant'),true);
select pg_temp.shop_test_actor('7103');
select public.get_repair_shop_vehicle(pg_temp.shop_test_id('shop'),'00000000-0000-4000-8000-000000007111');
select pg_temp.shop_test_actor('7104');
update shop_test_state set value=public.create_vehicle_transfer('00000000-0000-4000-8000-000000007111')->>'token' where key='token';
select pg_temp.shop_test_actor('7101');
select public.accept_vehicle_transfer(value) from shop_test_state where key='token';
select pg_temp.shop_test_actor('7103');
select pg_temp.shop_test_denied($q$select public.get_repair_shop_vehicle(pg_temp.shop_test_id('shop'),'00000000-0000-4000-8000-000000007111')$q$);
select pg_temp.shop_test_actor('7101');
update shop_test_state set value=public.request_vehicle_shop_authorization('00000000-0000-4000-8000-000000007111',pg_temp.shop_test_id('shop'))::text where key='grant';
select public.approve_vehicle_shop_authorization('00000000-0000-4000-8000-000000007111',pg_temp.shop_test_id('grant'),true);
select pg_temp.shop_test_actor('7102');
select public.revoke_vehicle_shop_authorization('00000000-0000-4000-8000-000000007111',pg_temp.shop_test_id('grant'));
select pg_temp.shop_test_actor('7103');
select pg_temp.shop_test_denied($q$select public.get_repair_shop_vehicle(pg_temp.shop_test_id('shop'),'00000000-0000-4000-8000-000000007111')$q$);
reset role;
do $$ declare function_row record; table_row record; begin
  if (select count(*) from public.service_visits where vehicle_id='00000000-0000-4000-8000-000000007111') <> 3
    or (select count(*) from app_private.repair_shop_service_records) <> 1
    or (select mileage from public.vehicles where id='00000000-0000-4000-8000-000000007111') <> 30000
    or (select interval_km from public.vehicle_maintenance_items where id='00000000-0000-4000-8000-000000007121') <> 10000 then
    raise exception 'Atomicity, provenance or baseline preservation failed';
  end if;
  for table_row in select oid, relname, relrowsecurity, relforcerowsecurity from pg_class
    where relnamespace='app_private'::regnamespace and relname in
      ('repair_shops','repair_shop_staff','vehicle_shop_authorizations','repair_shop_service_records')
  loop
    if not table_row.relrowsecurity or not table_row.relforcerowsecurity
      or has_table_privilege('authenticated',table_row.oid,'select,insert,update,delete')
      or has_table_privilege('anon',table_row.oid,'select,insert,update,delete') then
      raise exception 'Private table privilege boundary failed: %',table_row.relname;
    end if;
  end loop;
  for function_row in select p.oid,p.proname,p.prosecdef,p.proconfig,n.nspname from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace where p.proname in
      ('repair_shop_actor','lock_repair_shop','lock_shop_vehicle','create_repair_shop','request_repair_shop_membership',
       'set_repair_shop_staff','list_repair_shops','list_repair_shop_staff','request_vehicle_shop_authorization',
       'approve_vehicle_shop_authorization','revoke_vehicle_shop_authorization','list_vehicle_shop_authorizations',
       'list_repair_shop_authorizations','get_repair_shop_vehicle','create_repair_shop_service_visit')
  loop
    if not function_row.prosecdef or not ('search_path=""'=any(function_row.proconfig))
      or has_function_privilege('anon',function_row.oid,'execute')
      or (function_row.nspname='app_private' and has_function_privilege('authenticated',function_row.oid,'execute')) then
      raise exception 'RPC privilege boundary failed: %',function_row.proname;
    end if;
  end loop;
end; $$;
update app_private.firebase_provisioning_approvals set enabled=false where firebase_uid='fictional-shop-7103';
set local role authenticated;
select pg_temp.shop_test_actor('7103');
select pg_temp.shop_test_denied($q$select public.list_repair_shops()$q$);
select pg_temp.shop_test_actor('7102');
select set_config('request.jwt.claims',jsonb_set(auth.jwt(),'{app_owner_id}','"00000000-0000-4000-8000-000000007101"')::text,true);
select pg_temp.shop_test_denied($q$select public.create_repair_shop('Forged identity')$q$);
select pg_temp.shop_test_actor('7102');
select set_config('request.jwt.claims',jsonb_set(auth.jwt(),'{email_verified}','false')::text,true);
select pg_temp.shop_test_denied($q$select public.list_repair_shops()$q$);
select pg_temp.shop_test_actor('7102');
select set_config('request.jwt.claims',jsonb_set(auth.jwt(),'{iss}','"https://securetoken.google.com/foreign-project"')::text,true);
select pg_temp.shop_test_denied($q$select public.list_repair_shops()$q$);
reset role;
set local role anon;
select pg_temp.shop_test_denied($q$select public.create_repair_shop('Anonymous shop')$q$);
reset role;
rollback;
select 'PASS: repair shop roles, owner approval, sanitized facts, append-only records, isolation, rollback, removal, revocation, transfer epochs and RPC/RLS grants' as result;
