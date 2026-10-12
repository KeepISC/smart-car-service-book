-- Disposable test database only. Never run these fixtures on a remote project.
begin;
-- Override the seeded project only inside this rolled-back disposable fixture.
update app_private.firebase_config set project_id = 'fictional-project' where singleton;
insert into app_private.firebase_provisioning_approvals(firebase_uid, existing_owner_id) values
  ('approved-legacy-user', '00000000-0000-4000-8000-00000000a101'),
  ('conflicting-legacy-user', '00000000-0000-4000-8000-00000000a101');
select set_config('test.initial_owner_count', (select count(*)::text from app_private.app_users), true);
set local role scsb_provisioner;
do $$
declare first_owner uuid; repeated_owner uuid;
begin
  first_owner := app_private.provision_firebase_owner('approved-new-user', 'fictional-project');
  repeated_owner := app_private.provision_firebase_owner('approved-new-user', 'fictional-project');
  if first_owner is null or first_owner <> repeated_owner then raise exception 'Duplicate provisioning changed owner'; end if;
  if app_private.provision_firebase_owner('approved-legacy-user', 'fictional-project') <> '00000000-0000-4000-8000-00000000a101'::uuid then
    raise exception 'Legacy owner UUID changed';
  end if;
  if app_private.provision_firebase_owner('public-new-user', 'fictional-project') = first_owner then
    raise exception 'Distinct UID shared an owner';
  end if;
  begin
    perform app_private.provision_firebase_owner('approved-new-user', 'foreign-project');
    raise exception 'Foreign project provisioned';
  exception when insufficient_privilege then null; end;
  begin
    perform app_private.provision_firebase_owner('conflicting-legacy-user', 'fictional-project');
    raise exception 'Legacy owner stolen by another UID';
  exception when unique_violation then null; end;
  begin
    insert into app_private.firebase_provisioning_approvals(firebase_uid) values ('self-approved');
    raise exception 'Server could approve identities';
  exception when insufficient_privilege then null; end;
  begin
    perform id from public.vehicles;
    raise exception 'Provisioner could read vehicles';
  exception when insufficient_privilege then null; end;
  begin
    perform owner_id from app_private.firebase_identities;
    raise exception 'Provisioner could read private mappings';
  exception when insufficient_privilege then null; end;
end;
$$;
reset role;
do $$ begin
  if (select count(*) from app_private.app_users) <> current_setting('test.initial_owner_count')::integer + 2 then
    raise exception 'Duplicate requests created duplicate owners';
  end if;
  if not exists(select 1 from public.vehicles where id='00000000-0000-4000-8000-00000000a102' and owner_id='00000000-0000-4000-8000-00000000a101') then
    raise exception 'Legacy vehicle ownership changed';
  end if;
  if not exists(select 1 from public.vehicle_maintenance_items where id='00000000-0000-4000-8000-00000000a103' and vehicle_id='00000000-0000-4000-8000-00000000a102') then
    raise exception 'Legacy maintenance changed';
  end if;
end; $$;
-- A publicly registered UID must see only its fresh owner, never legacy records.
select set_config('request.jwt.claims', jsonb_build_object(
  'iss', 'https://securetoken.google.com/fictional-project',
  'aud', 'fictional-project', 'sub', 'public-new-user',
  'role', 'authenticated', 'email_verified', true,
  'app_owner_id', (select owner_id from app_private.firebase_identities where firebase_uid='public-new-user')
)::text, true);
set local role authenticated;
do $$ begin
  if public.current_app_owner() is null then raise exception 'Public registration did not grant own access'; end if;
  if exists(select 1 from public.vehicles where id='00000000-0000-4000-8000-00000000a102') then
    raise exception 'Public registration gained legacy vehicle access';
  end if;
  if exists(select 1 from public.vehicle_maintenance_items where id='00000000-0000-4000-8000-00000000a103') then
    raise exception 'Public registration gained legacy maintenance access';
  end if;
end; $$;
reset role;
set local role authenticated;
set local request.jwt.claims = '{"iss":"https://securetoken.google.com/fictional-project","aud":"fictional-project","sub":"approved-legacy-user","role":"authenticated","email_verified":true,"app_owner_id":"00000000-0000-4000-8000-00000000a101"}';
do $$ begin
  if public.current_app_owner() <> '00000000-0000-4000-8000-00000000a101'::uuid then raise exception 'Provisioned Firebase access failed'; end if;
  if (select count(*) from public.vehicles where id='00000000-0000-4000-8000-00000000a102') <> 1 then raise exception 'Legacy vehicle access lost'; end if;
  begin
    perform app_private.provision_firebase_owner('approved-new-user', 'fictional-project');
    raise exception 'Browser could call provisioning function';
  exception when insufficient_privilege then null; end;
end; $$;
reset role;
update app_private.firebase_provisioning_approvals set enabled=false where firebase_uid='approved-legacy-user';
set local role scsb_provisioner;
do $$ begin
  begin
    perform app_private.provision_firebase_owner('approved-legacy-user', 'fictional-project');
    raise exception 'Revoked identity provisioned';
  exception when insufficient_privilege then null; end;
end; $$;
set local role authenticated;
do $$ begin
  if public.current_app_owner() is not null then raise exception 'Revoked approval retained Firebase owner access'; end if;
  if exists(select 1 from public.vehicles where id='00000000-0000-4000-8000-00000000a102') then raise exception 'Revoked identity read vehicle'; end if;
end; $$;
rollback;
select 'PASS: automatic public provisioning, retries, stable legacy UUIDs, role restrictions and revocation' as result;
