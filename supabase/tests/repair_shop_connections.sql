-- Task 7.2 only: fictional fixtures in disposable PostgreSQL.
begin;
update app_private.firebase_config set project_id='fictional-project';
insert into app_private.app_users(id) values
  ('00000000-0000-4000-8000-000000007201'),('00000000-0000-4000-8000-000000007202'),
  ('00000000-0000-4000-8000-000000007203'),('00000000-0000-4000-8000-000000007204');
insert into app_private.firebase_identities(firebase_uid,owner_id)
  select 'fictional-connection-' || right(id::text,4),id from app_private.app_users where id::text like '00000000-0000-4000-8000-00000000720%';
insert into app_private.firebase_provisioning_approvals(firebase_uid)
  select firebase_uid from app_private.firebase_identities where firebase_uid like 'fictional-connection-%';
insert into public.vehicles(id,owner_id,type,make,model,year,engine,mileage,license_plate) values
  ('00000000-0000-4000-8000-000000007211','00000000-0000-4000-8000-000000007201','car','Fictional','Customer',2020,'Example',30000,'SECRET PLATE'),
  ('00000000-0000-4000-8000-000000007212','00000000-0000-4000-8000-000000007204','car','Fictional','Other',2020,'Example',30000,null);
create temp table connection_state(key text primary key,value jsonb);
grant select,insert,update on connection_state to authenticated;
create function pg_temp.connection_actor(p_suffix text) returns void language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('iss','https://securetoken.google.com/fictional-project',
    'aud','fictional-project','sub','fictional-connection-' || p_suffix,'role','authenticated','email_verified',true,
    'app_owner_id','00000000-0000-4000-8000-00000000' || p_suffix)::text,true)::void;
$$;
create function pg_temp.connection_id(p_key text) returns uuid language sql as $$
  select (value->>'id')::uuid from connection_state where key=p_key;
$$;
create function pg_temp.connection_token(p_key text) returns text language sql as $$
  select value->>'token' from connection_state where key=p_key;
$$;
create function pg_temp.connection_denied(p_sql text) returns void language plpgsql as $$
begin
  begin execute p_sql; exception when insufficient_privilege then return; end;
  raise exception 'Unauthorized connection operation succeeded';
end;
$$;
create function pg_temp.connection_invalid(p_sql text) returns void language plpgsql as $$
begin
  begin execute p_sql; exception when invalid_parameter_value then return; end;
  raise exception 'Invalid connection operation succeeded';
end;
$$;
set local role authenticated;
select pg_temp.connection_actor('7202');
insert into connection_state values ('shop',jsonb_build_object('id',public.create_repair_shop('Fictional connection shop')));
insert into connection_state values ('link',public.create_repair_shop_connection_invitation(pg_temp.connection_id('shop')));
select pg_temp.connection_invalid($q$select public.create_repair_shop_connection_invitation(pg_temp.connection_id('shop'),clock_timestamp()+interval '8 days')$q$);
select pg_temp.connection_actor('7203');
select public.request_repair_shop_membership(pg_temp.connection_id('shop'));
select pg_temp.connection_actor('7202');
select public.set_repair_shop_staff(pg_temp.connection_id('shop'),'00000000-0000-4000-8000-000000007203','mechanic');
select pg_temp.connection_actor('7203');
select pg_temp.connection_denied($q$select public.create_repair_shop_connection_invitation(pg_temp.connection_id('shop'))$q$);
select pg_temp.connection_denied($q$select public.cancel_repair_shop_connection_invitation(pg_temp.connection_id('shop'),pg_temp.connection_id('link'))$q$);
select pg_temp.connection_denied($q$select public.list_repair_shop_connection_invitations(pg_temp.connection_id('shop'))$q$);

-- Owner-initiated pending requests grant nothing; each side can resolve only its side.
select pg_temp.connection_actor('7201');
insert into connection_state values ('request',jsonb_build_object('id',public.request_vehicle_shop_authorization('00000000-0000-4000-8000-000000007211',pg_temp.connection_id('shop'))));
select pg_temp.connection_denied($q$select public.resolve_vehicle_shop_request('00000000-0000-4000-8000-000000007211',pg_temp.connection_id('request'),'declined')$q$);
select pg_temp.connection_invalid($q$select public.resolve_vehicle_shop_request('00000000-0000-4000-8000-000000007211',pg_temp.connection_id('request'),'expired')$q$);
select pg_temp.connection_actor('7202');
select pg_temp.connection_denied($q$select public.get_repair_shop_vehicle(pg_temp.connection_id('shop'),'00000000-0000-4000-8000-000000007211')$q$);
select pg_temp.connection_denied($q$select public.resolve_vehicle_shop_request('00000000-0000-4000-8000-000000007211',pg_temp.connection_id('request'),'cancelled')$q$);
select public.resolve_vehicle_shop_request('00000000-0000-4000-8000-000000007211',pg_temp.connection_id('request'),'declined');
select pg_temp.connection_actor('7201');
select pg_temp.connection_denied($q$select public.approve_vehicle_shop_authorization('00000000-0000-4000-8000-000000007211',pg_temp.connection_id('request'),true)$q$);
update connection_state set value=jsonb_build_object('id',public.request_vehicle_shop_authorization('00000000-0000-4000-8000-000000007211',pg_temp.connection_id('shop'))) where key='request';
select public.resolve_vehicle_shop_request('00000000-0000-4000-8000-000000007211',pg_temp.connection_id('request'),'cancelled');
select pg_temp.connection_actor('7202');
update connection_state set value=jsonb_build_object('id',public.request_vehicle_shop_authorization('00000000-0000-4000-8000-000000007211',pg_temp.connection_id('shop'))) where key='request';
select pg_temp.connection_actor('7201');
select public.resolve_vehicle_shop_request('00000000-0000-4000-8000-000000007211',pg_temp.connection_id('request'),'declined');
select pg_temp.connection_actor('7202');
update connection_state set value=jsonb_build_object('id',public.request_vehicle_shop_authorization('00000000-0000-4000-8000-000000007211',pg_temp.connection_id('shop'))) where key='request';
select public.resolve_vehicle_shop_request('00000000-0000-4000-8000-000000007211',pg_temp.connection_id('request'),'cancelled');

-- Link preview has no customer identity/vehicle, even for an unrelated bearer.
select pg_temp.connection_actor('7204');
do $$ declare preview jsonb; begin
  preview:=public.preview_repair_shop_connection_invitation(pg_temp.connection_token('link'));
  if preview->'shop'->>'name'<>'Fictional connection shop'
    or (preview - array['id','expires_at','shop'])<>'{}'::jsonb
    or ((preview->'shop') - array['id','name'])<>'{}'::jsonb then
    raise exception 'Invitation preview disclosed unexpected fields';
  end if;
end; $$;
select pg_temp.connection_denied($q$select public.accept_repair_shop_connection_invitation(pg_temp.connection_token('link'),'00000000-0000-4000-8000-000000007211',true)$q$);
select pg_temp.connection_denied($q$select public.preview_repair_shop_connection_invitation('malformed')$q$);
select pg_temp.connection_actor('7201');
select pg_temp.connection_invalid($q$select public.accept_repair_shop_connection_invitation(pg_temp.connection_token('link'),'00000000-0000-4000-8000-000000007211',null)$q$);
insert into connection_state values ('approved',jsonb_build_object('id',public.accept_repair_shop_connection_invitation(pg_temp.connection_token('link'),'00000000-0000-4000-8000-000000007211',false)));
select pg_temp.connection_denied($q$select public.preview_repair_shop_connection_invitation(pg_temp.connection_token('link'))$q$);
select pg_temp.connection_denied($q$select public.accept_repair_shop_connection_invitation(pg_temp.connection_token('link'),'00000000-0000-4000-8000-000000007211',true)$q$);
select pg_temp.connection_denied($q$select public.decline_repair_shop_connection_invitation(pg_temp.connection_token('link'))$q$);
select pg_temp.connection_actor('7202');
select public.get_repair_shop_vehicle(pg_temp.connection_id('shop'),'00000000-0000-4000-8000-000000007211');
select pg_temp.connection_denied($q$select public.create_repair_shop_service_visit(pg_temp.connection_id('shop'),'00000000-0000-4000-8000-000000007211','{}')$q$);
insert into connection_state values ('upgrade',public.create_repair_shop_connection_invitation(pg_temp.connection_id('shop')));
select pg_temp.connection_actor('7201');
select pg_temp.connection_denied($q$select public.accept_repair_shop_connection_invitation(pg_temp.connection_token('upgrade'),'00000000-0000-4000-8000-000000007211',true)$q$);
select public.revoke_vehicle_shop_authorization('00000000-0000-4000-8000-000000007211',pg_temp.connection_id('approved'));
select pg_temp.connection_actor('7202');
select pg_temp.connection_denied($q$select public.get_repair_shop_vehicle(pg_temp.connection_id('shop'),'00000000-0000-4000-8000-000000007211')$q$);
insert into connection_state values ('cancel',public.create_repair_shop_connection_invitation(pg_temp.connection_id('shop')));
select public.cancel_repair_shop_connection_invitation(pg_temp.connection_id('shop'),pg_temp.connection_id('cancel'));
select pg_temp.connection_actor('7201');
select pg_temp.connection_denied($q$select public.preview_repair_shop_connection_invitation(pg_temp.connection_token('cancel'))$q$);
select public.decline_repair_shop_connection_invitation(pg_temp.connection_token('upgrade'));
select pg_temp.connection_denied($q$select public.accept_repair_shop_connection_invitation(pg_temp.connection_token('upgrade'),'00000000-0000-4000-8000-000000007211',true)$q$);

-- Expiry does not need a background worker and cannot be reset by replay.
update connection_state set value=jsonb_build_object('id',public.request_vehicle_shop_authorization('00000000-0000-4000-8000-000000007211',pg_temp.connection_id('shop'))) where key='request';
select pg_temp.connection_actor('7202');
insert into connection_state values ('expired_link',public.create_repair_shop_connection_invitation(pg_temp.connection_id('shop')));
reset role;
update app_private.vehicle_shop_authorizations set created_at=clock_timestamp()-interval '2 days',expires_at=clock_timestamp()-interval '1 day'
  where id=pg_temp.connection_id('request');
update app_private.repair_shop_connection_invitations set created_at=clock_timestamp()-interval '2 days',expires_at=clock_timestamp()-interval '1 day'
  where id=pg_temp.connection_id('expired_link');
set local role authenticated;
select pg_temp.connection_actor('7201');
select pg_temp.connection_denied($q$select public.approve_vehicle_shop_authorization('00000000-0000-4000-8000-000000007211',pg_temp.connection_id('request'),true)$q$);
select pg_temp.connection_denied($q$select public.preview_repair_shop_connection_invitation(pg_temp.connection_token('expired_link'))$q$);
select pg_temp.connection_denied($q$select public.accept_repair_shop_connection_invitation(pg_temp.connection_token('expired_link'),'00000000-0000-4000-8000-000000007211',true)$q$);
select public.resolve_vehicle_shop_request('00000000-0000-4000-8000-000000007211',pg_temp.connection_id('request'),'expired');
insert into connection_state values ('fresh_request',jsonb_build_object('id',public.request_vehicle_shop_authorization('00000000-0000-4000-8000-000000007211',pg_temp.connection_id('shop'))));
do $$ begin
  if pg_temp.connection_id('fresh_request')=pg_temp.connection_id('request') then raise exception 'Expired request revived'; end if;
end; $$;
select public.resolve_vehicle_shop_request('00000000-0000-4000-8000-000000007211',pg_temp.connection_id('fresh_request'),'cancelled');
update connection_state set value=jsonb_build_object('id',public.request_vehicle_shop_authorization('00000000-0000-4000-8000-000000007211',pg_temp.connection_id('shop'))) where key='fresh_request';
reset role;
update app_private.vehicle_shop_authorizations set created_at=clock_timestamp()-interval '2 days',expires_at=clock_timestamp()-interval '1 day'
  where id=pg_temp.connection_id('fresh_request');
set local role authenticated;
select pg_temp.connection_actor('7201');
do $$ declare requests jsonb; renewed uuid; begin
  requests:=public.list_vehicle_shop_authorizations('00000000-0000-4000-8000-000000007211');
  if not exists(select 1 from jsonb_array_elements(requests) r where r->>'id'=pg_temp.connection_id('fresh_request')::text and r->>'status'='expired') then
    raise exception 'Effective request expiry missing';
  end if;
  renewed:=public.request_vehicle_shop_authorization('00000000-0000-4000-8000-000000007211',pg_temp.connection_id('shop'));
  if renewed=pg_temp.connection_id('fresh_request') then raise exception 'Automatic renewal revived expired request'; end if;
  perform public.resolve_vehicle_shop_request('00000000-0000-4000-8000-000000007211',renewed,'cancelled');
end; $$;

-- Issuer demotion permanently invalidates issued links, including after re-promotion.
select pg_temp.connection_actor('7204');
select public.request_repair_shop_membership(pg_temp.connection_id('shop'));
select pg_temp.connection_actor('7202');
select public.set_repair_shop_staff(pg_temp.connection_id('shop'),'00000000-0000-4000-8000-000000007204','admin');
insert into connection_state values ('old_issuer',public.create_repair_shop_connection_invitation(pg_temp.connection_id('shop')));
select pg_temp.connection_actor('7204');
select public.set_repair_shop_staff(pg_temp.connection_id('shop'),'00000000-0000-4000-8000-000000007202','mechanic');
select public.set_repair_shop_staff(pg_temp.connection_id('shop'),'00000000-0000-4000-8000-000000007202','admin');
select pg_temp.connection_actor('7201');
select pg_temp.connection_denied($q$select public.preview_repair_shop_connection_invitation(pg_temp.connection_token('old_issuer'))$q$);
select pg_temp.connection_actor('7202');
insert into connection_state values ('transfer_link',public.create_repair_shop_connection_invitation(pg_temp.connection_id('shop')));
reset role;
update app_private.firebase_provisioning_approvals set enabled=false where firebase_uid='fictional-connection-7202';
set local role authenticated;
select pg_temp.connection_actor('7201');
select pg_temp.connection_denied($q$select public.preview_repair_shop_connection_invitation(pg_temp.connection_token('transfer_link'))$q$);
reset role;
update app_private.firebase_provisioning_approvals set enabled=true where firebase_uid='fictional-connection-7202';
set local role authenticated;
select pg_temp.connection_actor('7201');
insert into connection_state values ('transfer',public.create_vehicle_transfer('00000000-0000-4000-8000-000000007211'));
select pg_temp.connection_actor('7204');
select public.accept_vehicle_transfer(pg_temp.connection_token('transfer'));
select pg_temp.connection_actor('7201');
select pg_temp.connection_denied($q$select public.accept_repair_shop_connection_invitation(pg_temp.connection_token('transfer_link'),'00000000-0000-4000-8000-000000007211',true)$q$);
select pg_temp.connection_actor('7204');
insert into connection_state values ('new_epoch',jsonb_build_object('id',public.accept_repair_shop_connection_invitation(pg_temp.connection_token('transfer_link'),'00000000-0000-4000-8000-000000007211',true)));
reset role;
do $$ declare row record; begin
  if (select ownership_epoch from app_private.vehicle_shop_authorizations where id=pg_temp.connection_id('new_epoch'))<>1
    or (select status from app_private.repair_shop_connection_invitations where id=pg_temp.connection_id('link'))<>'accepted'
    or (select can_create_records from app_private.vehicle_shop_authorizations where id=pg_temp.connection_id('approved')) then
    raise exception 'Epoch, replay or permission upgrade boundary failed';
  end if;
  if exists (select 1 from app_private.repair_shop_connection_invitations i where i.token_hash = convert_to(pg_temp.connection_token('link'),'UTF8'))
    or not exists (select 1 from app_private.repair_shop_connection_invitations i
      where i.id=pg_temp.connection_id('link') and i.token_hash=sha256(convert_to(pg_temp.connection_token('link'),'UTF8'))) then
    raise exception 'Token hashing failed';
  end if;
  if has_table_privilege('authenticated','app_private.repair_shop_connection_invitations','select,insert,update,delete')
    or not (select relrowsecurity and relforcerowsecurity from pg_class where oid='app_private.repair_shop_connection_invitations'::regclass)
    or has_function_privilege('authenticated','app_private.lock_shop_connection_invitation(text)','execute') then
    raise exception 'Private invitation boundary failed';
  end if;
  for row in select p.oid,p.prosecdef,p.proconfig from pg_proc p where p.proname in
    ('resolve_vehicle_shop_request','create_repair_shop_connection_invitation','preview_repair_shop_connection_invitation',
     'accept_repair_shop_connection_invitation','decline_repair_shop_connection_invitation','cancel_repair_shop_connection_invitation',
     'list_repair_shop_connection_invitations','lock_shop_connection_invitation')
  loop
    if not row.prosecdef or not ('search_path=""'=any(row.proconfig)) or has_function_privilege('anon',row.oid,'execute') then
      raise exception 'Connection RPC permissions failed';
    end if;
  end loop;
end; $$;
set local role anon;
select pg_temp.connection_denied($q$select public.preview_repair_shop_connection_invitation(pg_temp.connection_token('link'))$q$);
reset role;
rollback;
select 'PASS: connection approval, no customer preview, decline/cancel/expiry, single use, ownership epochs, issuer generations, atomic rollback and RLS/RPC boundaries' as result;
