-- Task 7.9A only: fictional data in a fresh disposable PostgreSQL instance.
begin;
update app_private.firebase_config set project_id='fictional-project';
insert into app_private.app_users(id) select ('00000000-0000-4000-8000-00000000' || n)::uuid from generate_series(7901,7905) n;
insert into app_private.firebase_identities(firebase_uid,owner_id) select 'fictional-integration-' || n,('00000000-0000-4000-8000-00000000' || n)::uuid from generate_series(7901,7905) n;
insert into app_private.firebase_provisioning_approvals(firebase_uid) select 'fictional-integration-' || n from generate_series(7901,7905) n;
insert into app_private.platform_administrators(user_id,active) values('00000000-0000-4000-8000-000000007901',true);
insert into app_private.repair_shops(id,name,subscription_status,subscription_starts_at,subscription_ends_at,suspended,contact_address) values
  ('00000000-0000-4000-8000-000000007921','Fictional Alpha','active',clock_timestamp()-interval '1 day',clock_timestamp()+interval '1 day',false,'Fictional town'),
  ('00000000-0000-4000-8000-000000007922','Fictional Beta','active',clock_timestamp()-interval '1 day',clock_timestamp()+interval '1 day',true,null),
  ('00000000-0000-4000-8000-000000007923','Fictional Gamma','pending',null,null,false,null);
insert into app_private.repair_shop_staff(shop_id,user_id,role,active) values
  ('00000000-0000-4000-8000-000000007921','00000000-0000-4000-8000-000000007902','admin',true),
  ('00000000-0000-4000-8000-000000007921','00000000-0000-4000-8000-000000007905','mechanic',true);
insert into public.vehicles(id,owner_id,type,make,model,year,engine,mileage) values
  ('00000000-0000-4000-8000-000000007911','00000000-0000-4000-8000-000000007903','car','Fictional','Shared',2020,'Example',10000),
  ('00000000-0000-4000-8000-000000007912','00000000-0000-4000-8000-000000007904','car','Fictional','Other',2020,'Example',10000);
insert into public.vehicle_maintenance_items(id,vehicle_id,name,interval_km,enabled,history_status,last_completed_mileage) values
  ('00000000-0000-4000-8000-000000007931','00000000-0000-4000-8000-000000007911','CONFIDENTIAL SCHEDULE',10000,true,'known',0);
insert into public.service_visits(id,vehicle_id,service_date,mileage,service_type,notes,total_cost,private_on_transfer) values
  ('00000000-0000-4000-8000-000000007941','00000000-0000-4000-8000-000000007911','2026-01-01',1000,'diy','SHARED OWNER NOTE',12.50,false),
  ('00000000-0000-4000-8000-000000007942','00000000-0000-4000-8000-000000007911','2026-01-02',2000,'diy','PRIVATE OWNER NOTE',99,true),
  ('00000000-0000-4000-8000-000000007943','00000000-0000-4000-8000-000000007912','2026-01-01',1000,'diy','OTHER OWNER NOTE',null,false);
insert into public.service_operations(service_visit_id,operation_name,cost) values
  ('00000000-0000-4000-8000-000000007941','SHARED OPERATION',12.50),
  ('00000000-0000-4000-8000-000000007942','PRIVATE OPERATION',99);
create temp table integration_state(key text primary key,id uuid);
grant all on integration_state to authenticated;
create function pg_temp.actor(n integer) returns void language sql as $$
  select set_config('request.jwt.claims',jsonb_build_object('iss','https://securetoken.google.com/fictional-project','aud','fictional-project','sub','fictional-integration-' || n,
    'role','authenticated','email_verified',true,'app_owner_id','00000000-0000-4000-8000-00000000' || n)::text,true)::void;
$$;
create function pg_temp.check_result(ok boolean,message text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception '%',message; end if; end; $$;
create function pg_temp.error(statement text,expected text) returns void language plpgsql as $$
begin begin execute statement; exception when others then if sqlstate=expected then return; else raise; end if; end; raise exception 'Expected % for %',expected,statement; end;
$$;
create function pg_temp.request_id() returns uuid language sql as $$ select id from integration_state where key='request'; $$;
create function pg_temp.projection() returns jsonb language sql as $$ select public.get_repair_shop_vehicle('00000000-0000-4000-8000-000000007921','00000000-0000-4000-8000-000000007911'); $$;
set local role authenticated;
select pg_temp.actor(7901);
select pg_temp.check_result(public.platform_search_repair_shops('fictional','active',0,1)->>'total'='1','Status filter failed');
select pg_temp.check_result(public.platform_search_repair_shops('Alpha',null,9,1)->>'total'='1' and public.platform_search_repair_shops('Alpha',null,9,1)->'items'='[]'::jsonb,'Out-of-range page lost count');
select pg_temp.check_result(public.platform_search_repair_shops('fictional',null,1,1)->'items'->0->>'name'='Fictional Beta','Unstable pagination');
select pg_temp.check_result(public.platform_search_repair_shops('%')->>'total'='0','Search interpreted wildcard');
select pg_temp.error($q$select public.platform_search_repair_shops('', 'invalid')$q$,'22023');
select pg_temp.check_result(public.platform_list_shop_administrators('00000000-0000-4000-8000-000000007921')->0 = '{"firebase_uid":"fictional-integration-7902","enabled":true}'::jsonb,'Administrator projection too broad');
select pg_temp.check_result(public.platform_find_provisioned_users('integration-7902')->'items'->0 = '{"firebase_uid":"fictional-integration-7902"}'::jsonb,'User lookup too broad');
select pg_temp.error($q$select public.platform_find_provisioned_users('')$q$,'22023');
select pg_temp.actor(7902);
select pg_temp.error($q$select public.platform_find_provisioned_users('fictional')$q$,'42501');
select pg_temp.error($q$select public.platform_list_shop_administrators('00000000-0000-4000-8000-000000007921')$q$,'42501');
select pg_temp.error($q$select public.platform_search_repair_shops()$q$,'42501');
select pg_temp.actor(7903);
select pg_temp.check_result(public.search_available_repair_shops('00000000-0000-4000-8000-000000007911','town')->>'total'='1','Owner directory missing active shop');
select pg_temp.check_result(not (public.search_available_repair_shops('00000000-0000-4000-8000-000000007911')->'items'->0 ? 'subscription_status'),'Directory leaked private config');
select pg_temp.error($q$select public.search_available_repair_shops('00000000-0000-4000-8000-000000007912')$q$,'42501');
select pg_temp.actor(7904);
insert into integration_state values('decline_request',public.request_vehicle_shop_authorization('00000000-0000-4000-8000-000000007912','00000000-0000-4000-8000-000000007921'));
select pg_temp.actor(7902);
select public.review_owner_shop_request('00000000-0000-4000-8000-000000007912',(select id from integration_state where key='decline_request'),'declined');
select pg_temp.actor(7904);
select pg_temp.error($q$select public.approve_vehicle_shop_authorization('00000000-0000-4000-8000-000000007912',(select id from integration_state where key='decline_request'),false)$q$,'42501');
select pg_temp.actor(7903);
insert into integration_state values('request',public.request_vehicle_shop_authorization('00000000-0000-4000-8000-000000007911','00000000-0000-4000-8000-000000007921'));
select pg_temp.actor(7905);
select pg_temp.error($q$select public.review_owner_shop_request('00000000-0000-4000-8000-000000007911',pg_temp.request_id(),'accepted')$q$,'42501');
select pg_temp.actor(7902);
select public.review_owner_shop_request('00000000-0000-4000-8000-000000007911',pg_temp.request_id(),'accepted');
select pg_temp.check_result(exists(select 1 from jsonb_array_elements(public.list_repair_shop_authorizations('00000000-0000-4000-8000-000000007921')) entry
  where entry->>'id'=pg_temp.request_id()::text and entry->>'status'='pending'),'Acceptance bypassed owner approval');
select pg_temp.check_result(exists(select 1 from jsonb_array_elements(public.list_repair_shop_authorizations('00000000-0000-4000-8000-000000007921')) entry
  where entry->>'id'=pg_temp.request_id()::text and entry->>'shop_accepted_at' is not null),'Acceptance not visible');
select pg_temp.error('select pg_temp.projection()','42501');
select pg_temp.error($q$select public.approve_vehicle_shop_authorization('00000000-0000-4000-8000-000000007911',pg_temp.request_id(),true)$q$,'42501');
select pg_temp.actor(7903);
select public.approve_vehicle_shop_authorization('00000000-0000-4000-8000-000000007911',pg_temp.request_id(),true);
select pg_temp.actor(7902);
select pg_temp.check_result(pg_temp.projection()::text not like '%OWNER NOTE%' and pg_temp.projection()::text not like '%CONFIDENTIAL SCHEDULE%','Default projection leaked text');
insert into integration_state values('workshop',public.create_repair_shop_service_visit('00000000-0000-4000-8000-000000007921','00000000-0000-4000-8000-000000007911',
  '{"service_date":"2026-02-01","mileage":5000,"notes":"WORKSHOP NOTE","total_cost":50,"operations":[{"operation_name":"WORKSHOP OPERATION","cost":50}]}'));
select pg_temp.error($q$select public.set_vehicle_shop_data_sharing('00000000-0000-4000-8000-000000007911',pg_temp.request_id(),'Customer alias',true,array['00000000-0000-4000-8000-000000007941'::uuid])$q$,'42501');
select pg_temp.actor(7903);
select pg_temp.error($q$select public.set_vehicle_shop_data_sharing('00000000-0000-4000-8000-000000007911',pg_temp.request_id(),'Customer alias',true,array['00000000-0000-4000-8000-000000007942'::uuid])$q$,'42501');
select pg_temp.error($q$select public.set_vehicle_shop_data_sharing('00000000-0000-4000-8000-000000007911',pg_temp.request_id(),'Customer alias',true,array['00000000-0000-4000-8000-000000007943'::uuid])$q$,'42501');
select public.set_vehicle_shop_data_sharing('00000000-0000-4000-8000-000000007911',pg_temp.request_id(),'Customer alias',true,
  array['00000000-0000-4000-8000-000000007941'::uuid,(select id from integration_state where key='workshop')]);
select pg_temp.actor(7902);
select pg_temp.check_result(pg_temp.projection()->>'customer_reference'='Customer alias' and pg_temp.projection()::text like '%CONFIDENTIAL SCHEDULE%' and pg_temp.projection()::text like '%SHARED OWNER NOTE%' and pg_temp.projection()::text like '%SHARED OPERATION%' and pg_temp.projection()::text like '%WORKSHOP NOTE%' and pg_temp.projection()::text like '%recorded_at%','Explicit projection missing authorized data');
select pg_temp.check_result(pg_temp.projection()::text not like '%PRIVATE OWNER NOTE%' and pg_temp.projection()::text not like '%PRIVATE OPERATION%' and pg_temp.projection()::text not like '%author_id%','Private data leaked');
reset role;
update public.service_visits set private_on_transfer=true where id='00000000-0000-4000-8000-000000007941';
set local role authenticated;
select pg_temp.check_result(pg_temp.projection()::text not like '%SHARED OWNER NOTE%','Later privacy change ignored');
select pg_temp.actor(7903);
select public.set_vehicle_shop_data_sharing('00000000-0000-4000-8000-000000007911',pg_temp.request_id(),null,false,'{}');
select pg_temp.actor(7902);
select pg_temp.check_result(pg_temp.projection()::text not like '%WORKSHOP NOTE%' and pg_temp.projection()::text not like '%Customer alias%','Sharing withdrawal failed');
reset role;
update app_private.firebase_provisioning_approvals set enabled=false where firebase_uid='fictional-integration-7902';
set local role authenticated;
select pg_temp.actor(7901);
select pg_temp.check_result(public.platform_find_provisioned_users('integration-7902')->>'total'='0','Disabled UID advertised as candidate');
select pg_temp.check_result(public.platform_list_shop_administrators('00000000-0000-4000-8000-000000007921')->0->>'enabled'='false','Disabled admin hidden from revocation list');
select pg_temp.actor(7903);
select pg_temp.check_result(public.search_available_repair_shops('00000000-0000-4000-8000-000000007911')->>'total'='0','Directory advertised inaccessible admin');
reset role;
update app_private.firebase_provisioning_approvals set enabled=true where firebase_uid='fictional-integration-7902';
update public.vehicles set owner_id='00000000-0000-4000-8000-000000007904',ownership_epoch=ownership_epoch+1 where id='00000000-0000-4000-8000-000000007911';
set local role authenticated;
select pg_temp.actor(7902);
select pg_temp.error('select pg_temp.projection()','42501');
select pg_temp.actor(7903);
select pg_temp.error($q$select public.set_vehicle_shop_data_sharing('00000000-0000-4000-8000-000000007911',pg_temp.request_id(),null,false,'{}')$q$,'42501');
select pg_temp.actor(7904);
insert into integration_state values('new_owner_request',public.request_vehicle_shop_authorization('00000000-0000-4000-8000-000000007911','00000000-0000-4000-8000-000000007921'));
select public.approve_vehicle_shop_authorization('00000000-0000-4000-8000-000000007911',(select id from integration_state where key='new_owner_request'),false);
select pg_temp.actor(7902);
select pg_temp.check_result(pg_temp.projection()::text not like '%Customer alias%' and pg_temp.projection()::text not like '%WORKSHOP NOTE%' and pg_temp.projection()::text not like '%CONFIDENTIAL SCHEDULE%','New owner authorization inherited sharing');
reset role;
do $$ begin
  if not(select relrowsecurity and relforcerowsecurity from pg_class where oid='app_private.shop_service_record_shares'::regclass)
    or has_table_privilege('authenticated','app_private.shop_service_record_shares','select')
    or has_function_privilege('authenticated','app_private.base_get_repair_shop_vehicle(uuid,uuid)','execute')
    or has_function_privilege('anon','public.platform_search_repair_shops(text,text,integer,integer)','execute') then raise exception 'Unsafe integration grants'; end if;
end; $$;
rollback;
select 'Task 7.9A SQL integration PASS' result;
