-- Task 7.4 only; fictional data in disposable PostgreSQL, never hosted Supabase.
begin;
update app_private.firebase_config set project_id='fictional-project';
insert into app_private.app_users(id) values
  ('00000000-0000-4000-8000-000000007401'),('00000000-0000-4000-8000-000000007402'),
  ('00000000-0000-4000-8000-000000007403'),('00000000-0000-4000-8000-000000007404'),
  ('00000000-0000-4000-8000-000000007405');
insert into app_private.firebase_identities(firebase_uid,owner_id)
  select 'fictional-platform-' || right(id::text,4),id from app_private.app_users where id::text like '00000000-0000-4000-8000-00000000740%';
insert into app_private.firebase_provisioning_approvals(firebase_uid)
  select firebase_uid from app_private.firebase_identities where firebase_uid like 'fictional-platform-%';
insert into public.vehicles(id,owner_id,type,make,model,year,engine,mileage) values
  ('00000000-0000-4000-8000-000000007411','00000000-0000-4000-8000-000000007404','car','Fictional','Personal',2020,'Example',30000),
  ('00000000-0000-4000-8000-000000007412','00000000-0000-4000-8000-000000007404','car','Fictional','Second',2020,'Example',30000);
insert into public.service_visits(id,vehicle_id,service_date,mileage,service_type,notes,private_on_transfer) values
  ('00000000-0000-4000-8000-000000007421','00000000-0000-4000-8000-000000007411','2026-01-31',25000,'diy','SECRET OWNER HISTORY',true);
create temp table platform_state(key text primary key,value jsonb);
grant select,insert,update on platform_state to authenticated;
create function pg_temp.platform_actor(p_suffix text) returns void language sql as $$
  select set_config('request.jwt.claims',jsonb_build_object('iss','https://securetoken.google.com/fictional-project',
    'aud','fictional-project','sub','fictional-platform-' || p_suffix,'role','authenticated','email_verified',true,
    'app_owner_id','00000000-0000-4000-8000-00000000' || p_suffix)::text,true)::void;
$$;
create function pg_temp.platform_id(p_key text) returns uuid language sql as $$
  select (value->>'id')::uuid from platform_state where key=p_key;
$$;
create function pg_temp.platform_token() returns text language sql as $$
  select value->>'token' from platform_state where key='link';
$$;
create function pg_temp.platform_denied(p_sql text) returns void language plpgsql as $$
begin
  begin execute p_sql; exception when insufficient_privilege then return; end;
  raise exception 'Unauthorized platform/shop operation succeeded';
end;
$$;
create function pg_temp.platform_invalid(p_sql text) returns void language plpgsql as $$
begin
  begin execute p_sql; exception when check_violation or invalid_parameter_value or not_null_violation then return; end;
  raise exception 'Invalid administration mutation succeeded';
end;
$$;
create function pg_temp.activate_shop(p_status text default 'active',p_start timestamptz default clock_timestamp()-interval '1 day',
  p_end timestamptz default clock_timestamp()+interval '30 days',p_staff integer default 2,p_connections integer default 1,p_records integer default 1)
returns void language sql as $$
  select public.platform_set_shop_subscription(pg_temp.platform_id('shop'),jsonb_build_object('plan_code','manual-test',
    'status',p_status,'starts_at',p_start,'ends_at',p_end,'limits',jsonb_build_object('max_active_staff',p_staff,
      'max_connected_vehicles',p_connections,'max_monthly_records',p_records)),'Fictional manual subscription');
$$;
-- Exercise each existing protected path under disabled entitlements, not old audits.
create function pg_temp.disabled_shop_checks() returns void language plpgsql as $$
begin
  perform pg_temp.platform_actor('7402');
  if public.list_repair_shops()<>'[]'::jsonb then raise exception 'Disabled shop advertised as available'; end if;
  perform pg_temp.platform_denied($q$select public.list_repair_shop_staff(pg_temp.platform_id('shop'))$q$);
  perform pg_temp.platform_denied($q$select public.list_repair_shop_authorizations(pg_temp.platform_id('shop'))$q$);
  perform pg_temp.platform_denied($q$select public.create_repair_shop_connection_invitation(pg_temp.platform_id('shop'))$q$);
  perform pg_temp.platform_denied($q$select public.list_repair_shop_connection_invitations(pg_temp.platform_id('shop'))$q$);
  perform pg_temp.platform_denied($q$select public.cancel_repair_shop_connection_invitation(pg_temp.platform_id('shop'),pg_temp.platform_id('link'))$q$);
  perform pg_temp.platform_denied($q$select public.request_repair_shop_membership(pg_temp.platform_id('shop'))$q$);
  perform pg_temp.platform_denied($q$select public.set_repair_shop_staff(pg_temp.platform_id('shop'),'00000000-0000-4000-8000-000000007403','mechanic')$q$);
  perform pg_temp.platform_denied($q$select public.get_repair_shop_vehicle(pg_temp.platform_id('shop'),'00000000-0000-4000-8000-000000007411')$q$);
  perform pg_temp.platform_denied($q$select public.create_repair_shop_service_visit(pg_temp.platform_id('shop'),'00000000-0000-4000-8000-000000007411','{}')$q$);
  perform pg_temp.platform_actor('7404');
  perform pg_temp.platform_denied($q$select public.request_vehicle_shop_authorization('00000000-0000-4000-8000-000000007412',pg_temp.platform_id('shop'))$q$);
  perform pg_temp.platform_denied($q$select public.approve_vehicle_shop_authorization('00000000-0000-4000-8000-000000007412',pg_temp.platform_id('pending'),true)$q$);
  perform pg_temp.platform_denied($q$select public.preview_repair_shop_connection_invitation(pg_temp.platform_token())$q$);
  perform pg_temp.platform_denied($q$select public.decline_repair_shop_connection_invitation(pg_temp.platform_token())$q$);
  perform pg_temp.platform_denied($q$select public.accept_repair_shop_connection_invitation(pg_temp.platform_token(),'00000000-0000-4000-8000-000000007412',true)$q$);
  if not exists(select 1 from public.vehicles where id='00000000-0000-4000-8000-000000007411')
    or not exists(select 1 from public.service_visits where id='00000000-0000-4000-8000-000000007421' and notes='SECRET OWNER HISTORY') then
    raise exception 'Personal ownership or history was lost';
  end if;
end;
$$;

set local role authenticated;
select pg_temp.platform_actor('7401');
do $$ begin if public.is_platform_administrator() then raise exception 'Platform role self-registered'; end if; end; $$;
select pg_temp.platform_denied($q$select public.platform_create_repair_shop('{"business_name":"Untrusted"}','Create')$q$);
select pg_temp.platform_denied($q$select app_private.set_platform_administrator('fictional-platform-7401',true,'Self-registration')$q$);
select set_config('request.jwt.claims',(auth.jwt() || '{"platform_admin":true}'::jsonb)::text,true);
select pg_temp.platform_denied($q$select public.platform_list_repair_shops()$q$);
reset role;
select app_private.set_platform_administrator('fictional-platform-7401',true,'Fictional independently verified bootstrap');
set local role authenticated;
select pg_temp.platform_actor('7401');
insert into platform_state values ('shop',jsonb_build_object('id',public.platform_create_repair_shop(
  '{"business_name":"Fictional managed shop","logo_reference":"logos/fictional","primary_color":"#123456","contact_email":"shop@example.test"}','Create shop')));
do $$ begin
  if not public.is_platform_administrator() or public.list_repair_shops()<>'[]'::jsonb
    or public.platform_list_repair_shops()->0->>'access_status'<>'pending' then raise exception 'Platform and shop roles conflated'; end if;
end; $$;
select public.platform_set_shop_administrator(pg_temp.platform_id('shop'),'fictional-platform-7402',true,'Assign first shop admin');
select pg_temp.activate_shop();
select pg_temp.platform_actor('7403');
select public.request_repair_shop_membership(pg_temp.platform_id('shop'));
select pg_temp.platform_actor('7402');
select public.set_repair_shop_staff(pg_temp.platform_id('shop'),'00000000-0000-4000-8000-000000007403','mechanic');
select pg_temp.platform_denied($q$select public.platform_set_shop_suspension(pg_temp.platform_id('shop'),false,'Shop admin escalation')$q$);
select pg_temp.platform_denied($q$select public.platform_list_shop_audit()$q$);
select pg_temp.platform_actor('7405');
select public.request_repair_shop_membership(pg_temp.platform_id('shop'));
select pg_temp.platform_actor('7402');
select pg_temp.platform_invalid($q$select public.set_repair_shop_staff(pg_temp.platform_id('shop'),'00000000-0000-4000-8000-000000007405','mechanic')$q$);
select pg_temp.platform_actor('7401');
select pg_temp.platform_invalid($q$select public.platform_set_shop_administrator(pg_temp.platform_id('shop'),'fictional-platform-7405',true,'Exceed staff cap')$q$);
select pg_temp.platform_invalid($q$select public.platform_update_repair_shop(pg_temp.platform_id('shop'),'{"business_name":"Should roll back"}',' ')$q$);
select pg_temp.platform_invalid($q$select public.platform_update_repair_shop(pg_temp.platform_id('shop'),'{"business_name":"Invalid","primary_color":"red"}','Bad color')$q$);
select pg_temp.platform_invalid($q$select public.platform_update_repair_shop(pg_temp.platform_id('shop'),'{"business_name":"Invalid","logo_reference":"javascript:alert(1)"}','Bad logo')$q$);
select pg_temp.platform_invalid($q$select public.platform_set_shop_subscription(pg_temp.platform_id('shop'),'{"plan_code":"manual","status":"active","starts_at":null,"ends_at":null,"limits":{}}','Invalid window')$q$);
select pg_temp.platform_invalid($q$select public.platform_set_shop_subscription(pg_temp.platform_id('shop'),'{"plan_code":"manual","status":"pending","limits":{"max_active_staff":-1}}','Invalid limit')$q$);

select pg_temp.platform_actor('7404');
insert into platform_state values ('approved',jsonb_build_object('id',public.request_vehicle_shop_authorization('00000000-0000-4000-8000-000000007411',pg_temp.platform_id('shop'))));
select public.approve_vehicle_shop_authorization('00000000-0000-4000-8000-000000007411',pg_temp.platform_id('approved'),true);
insert into platform_state values ('pending',jsonb_build_object('id',public.request_vehicle_shop_authorization('00000000-0000-4000-8000-000000007412',pg_temp.platform_id('shop'))));
select pg_temp.platform_invalid($q$select public.approve_vehicle_shop_authorization('00000000-0000-4000-8000-000000007412',pg_temp.platform_id('pending'),true)$q$);
select pg_temp.platform_actor('7402');
insert into platform_state values ('link',public.create_repair_shop_connection_invitation(pg_temp.platform_id('shop')));
insert into platform_state values ('visit',jsonb_build_object('id',public.create_repair_shop_service_visit(pg_temp.platform_id('shop'),
  '00000000-0000-4000-8000-000000007411','{"service_date":"2026-02-28","mileage":26000,"operations":[{"operation_name":"Fictional work"}]}')));
reset role;
-- Simulate an old transaction timestamp; quota uses immutable wall-clock provenance.
update public.service_visits set created_at=clock_timestamp()-interval '40 days' where id=pg_temp.platform_id('visit');
set local role authenticated;
select pg_temp.platform_actor('7402');
select pg_temp.platform_invalid($q$select public.create_repair_shop_service_visit(pg_temp.platform_id('shop'),'00000000-0000-4000-8000-000000007411','{"service_date":"2026-02-28","mileage":26000,"operations":[{"operation_name":"Above quota"}]}')$q$);
select pg_temp.platform_actor('7401');
select public.platform_update_repair_shop(pg_temp.platform_id('shop'),
  '{"business_name":"Fictional rebranded shop","logo_reference":"logos/updated","primary_color":"#ABCDEF","secondary_color":"#112233","contact_phone":"+1 555 0100","contact_address":"Fictional street","contact_website":"https://example.test"}','Update branding');
select pg_temp.platform_denied($q$select public.get_repair_shop_vehicle(pg_temp.platform_id('shop'),'00000000-0000-4000-8000-000000007411')$q$);
select public.platform_set_shop_suspension(pg_temp.platform_id('shop'),true,'Administrative suspension');
select pg_temp.disabled_shop_checks();
select pg_temp.platform_actor('7401');
select public.platform_set_shop_suspension(pg_temp.platform_id('shop'),false,'Reactivate');
select pg_temp.activate_shop('active',clock_timestamp()-interval '2 days',clock_timestamp()-interval '1 day');
select pg_temp.disabled_shop_checks();
select pg_temp.platform_actor('7401');
select pg_temp.activate_shop('active',clock_timestamp()+interval '1 day',clock_timestamp()+interval '2 days');
select pg_temp.disabled_shop_checks();
select pg_temp.platform_actor('7401');
select pg_temp.activate_shop('disabled');
select pg_temp.disabled_shop_checks();
select pg_temp.platform_actor('7401');
select pg_temp.activate_shop('pending');
select pg_temp.disabled_shop_checks();

-- Owner cleanup remains available while the shop is disabled.
select pg_temp.platform_actor('7404');
select public.resolve_vehicle_shop_request('00000000-0000-4000-8000-000000007412',pg_temp.platform_id('pending'),'cancelled');
select public.revoke_vehicle_shop_authorization('00000000-0000-4000-8000-000000007411',pg_temp.platform_id('approved'));
select pg_temp.platform_actor('7401');
select pg_temp.activate_shop();
select pg_temp.platform_actor('7404');
insert into platform_state values ('new_epoch',jsonb_build_object('id',public.accept_repair_shop_connection_invitation(pg_temp.platform_token(),'00000000-0000-4000-8000-000000007412',true)));
insert into platform_state values ('transfer',public.create_vehicle_transfer('00000000-0000-4000-8000-000000007412'));
select pg_temp.platform_actor('7405');
select public.accept_vehicle_transfer((select value->>'token' from platform_state where key='transfer'));
select pg_temp.platform_actor('7402');
select pg_temp.platform_denied($q$select public.get_repair_shop_vehicle(pg_temp.platform_id('shop'),'00000000-0000-4000-8000-000000007412')$q$);

-- Platform may recover a shop with no admin, including while suspended.
select pg_temp.platform_actor('7401');
select public.platform_set_shop_suspension(pg_temp.platform_id('shop'),true,'Suspend for admin recovery');
select public.platform_set_shop_administrator(pg_temp.platform_id('shop'),'fictional-platform-7402',false,'Remove last shop admin');
select public.platform_set_shop_administrator(pg_temp.platform_id('shop'),'fictional-platform-7405',true,'Assign replacement admin');
select public.platform_set_shop_administrator(pg_temp.platform_id('shop'),'fictional-platform-7405',false,'Remove replacement');
select public.platform_set_shop_administrator(pg_temp.platform_id('shop'),'fictional-platform-7402',true,'Restore original admin');
select public.platform_set_shop_suspension(pg_temp.platform_id('shop'),false,'Finish recovery');
do $$ declare audit jsonb; shop jsonb; begin
  audit:=public.platform_list_shop_audit(pg_temp.platform_id('shop'));
  shop:=public.platform_list_repair_shops()->0;
  if jsonb_array_length(audit)<10 or shop->>'name'<>'Fictional rebranded shop'
    or shop->>'primary_color'<>'#ABCDEF' or shop->>'contact_website'<>'https://example.test' then
    raise exception 'Audit or branding metadata missing'; end if;
  if exists(select 1 from jsonb_array_elements(audit) a where a->>'actor_id'<>'00000000-0000-4000-8000-000000007401') then
    raise exception 'Audit actor was caller-selected'; end if;
end; $$;
reset role;
do $$ declare row record; begin
  if (select count(*) from public.service_visits where vehicle_id='00000000-0000-4000-8000-000000007411')<>2
    or (select mileage from public.vehicles where id='00000000-0000-4000-8000-000000007411')<>30000
    or (select status from app_private.vehicle_shop_authorizations where id=pg_temp.platform_id('pending'))<>'cancelled' then
    raise exception 'History, quota rollback or cleanup preservation failed'; end if;
  for row in select p.oid,n.nspname,p.proname,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','app_private') and (p.proname like 'platform_%' or p.proname in ('lock_platform_administrator','audit_platform_shop_change',
      'set_platform_administrator','require_shop_access','check_shop_staff_capacity','write_shop_profile','is_platform_administrator')
      or (n.nspname='app_private' and p.proname like 'base_%'))
  loop
    if not row.prosecdef or not ('search_path=""'=any(row.proconfig)) or has_function_privilege('anon',row.oid,'execute')
      or (row.nspname='app_private' and has_function_privilege('authenticated',row.oid,'execute')) then
      raise exception 'Administration/delegate RPC boundary failed: %',row.proname; end if;
  end loop;
  for row in select oid,relrowsecurity,relforcerowsecurity from pg_class where oid in
    ('app_private.platform_administrators'::regclass,'app_private.platform_shop_audit'::regclass)
  loop
    if not row.relrowsecurity or not row.relforcerowsecurity or has_table_privilege('authenticated',row.oid,'select,insert,update,delete')
      or has_table_privilege('anon',row.oid,'select,insert,update,delete') then raise exception 'Platform private-table boundary failed'; end if;
  end loop;
end; $$;
select app_private.set_platform_administrator('fictional-platform-7401',false,'Revoke platform authority');
set local role authenticated;
select pg_temp.platform_actor('7401');
select pg_temp.platform_denied($q$select public.platform_list_repair_shops()$q$);
reset role;
rollback;
select 'PASS: independent trusted platform role, audited branding/subscriptions/admin recovery, all disabled-shop paths, capacity, owner/history preservation and connection epochs' as result;
