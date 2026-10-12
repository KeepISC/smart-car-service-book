begin;

-- UUID owners remain unchanged; verified identities are provisioned by the trusted server.
create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;
create table app_private.app_users (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);
insert into app_private.app_users (id) select id from auth.users;
create table app_private.firebase_config (
  singleton boolean primary key default true check (singleton),
  project_id text not null check (project_id ~ '^[a-z][a-z0-9-]{4,28}[a-z0-9]$')
);
-- Firebase project configuration explicitly approved for this migration.
INSERT INTO app_private.firebase_config (project_id)
VALUES ('smart-car-service-book-61a9d');
create table app_private.firebase_identities (
  firebase_uid text primary key check (char_length(firebase_uid) between 1 and 128),
  owner_id uuid not null unique references app_private.app_users(id) on delete cascade,
  created_at timestamptz not null default now()
);
-- Historical table name retained for private legacy mappings and access controls.
-- Ordinary users receive an enabled row automatically. Existing owners require
-- proof of control and an explicit UUID mapping; never authorize by email.
create table app_private.firebase_provisioning_approvals (
  firebase_uid text primary key check (char_length(firebase_uid) between 1 and 128),
  existing_owner_id uuid references app_private.app_users(id) on delete restrict,
  enabled boolean not null default true,
  approved_at timestamptz not null default now()
);
alter table app_private.app_users enable row level security;
alter table app_private.app_users force row level security;
alter table app_private.firebase_config enable row level security;
alter table app_private.firebase_config force row level security;
alter table app_private.firebase_identities enable row level security;
alter table app_private.firebase_identities force row level security;
alter table app_private.firebase_provisioning_approvals enable row level security;
alter table app_private.firebase_provisioning_approvals force row level security;
revoke all on all tables in schema app_private from public, anon, authenticated;

-- A separate server login inherits only this role. It cannot approve identities,
-- select private tables, or access vehicle/maintenance data.
create role scsb_provisioner nologin nosuperuser nocreatedb nocreaterole nobypassrls;
grant usage on schema app_private to scsb_provisioner;
create function app_private.provision_firebase_owner(uid text, requested_project text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  approved_owner uuid;
  result uuid;
begin
  if requested_project is null or not exists (
    select 1 from app_private.firebase_config where project_id = requested_project
  ) then
    raise exception 'Provisioning project is not configured' using errcode = '42501';
  end if;
  -- Only the trusted token-verifying server may call this function. Insert the
  -- per-UID lock before allocating an owner; uniqueness serializes first requests
  -- across instances. Never overwrite a legacy mapping or re-enable a blocked UID.
  insert into app_private.firebase_provisioning_approvals(firebase_uid)
    values (uid) on conflict (firebase_uid) do nothing;
  select existing_owner_id into approved_owner
    from app_private.firebase_provisioning_approvals
    where firebase_uid = uid and enabled for update;
  if not found then
    raise exception 'Identity access is disabled' using errcode = '42501';
  end if;
  select owner_id into result from app_private.firebase_identities where firebase_uid = uid;
  if found then
    if approved_owner is not null and approved_owner <> result then
      raise exception 'Existing mapping cannot be reassigned' using errcode = '42501';
    end if;
    return result;
  end if;
  result := approved_owner;
  if result is null then
    insert into app_private.app_users default values returning id into result;
  end if;
  -- The unique owner constraint prevents a second Firebase UID claiming a legacy
  -- owner. Any conflict rolls back the entire statement, including a new owner.
  insert into app_private.firebase_identities(firebase_uid, owner_id) values (uid, result);
  return result;
end;
$$;
revoke all on function app_private.provision_firebase_owner(text, text) from public, anon, authenticated;
grant execute on function app_private.provision_firebase_owner(text, text) to scsb_provisioner;

create function public.current_app_owner() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  claims jsonb := auth.jwt();
  project text;
  result uuid;
begin
  select project_id into project from app_private.firebase_config where singleton;
  if project is not null
    and claims ->> 'iss' = 'https://securetoken.google.com/' || project
    and claims ->> 'aud' = project
    and claims ->> 'role' = 'authenticated'
    and claims ->> 'email_verified' = 'true' then
    select i.owner_id into result from app_private.firebase_identities i
      join app_private.firebase_provisioning_approvals a using (firebase_uid)
      where i.firebase_uid = claims ->> 'sub' and i.owner_id::text = claims ->> 'app_owner_id'
        and a.enabled;
    return result;
  end if;
  -- Coexistence with existing Supabase sessions, whose signature/project is verified by the gateway.
  -- Firebase subjects never pass through auth.uid(), which casts the subject to UUID.
  if claims ->> 'aud' = 'authenticated'
    and claims ->> 'iss' ~ '^https://[a-z]{20}\.supabase\.co/auth/v1$'
    and claims ->> 'sub' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return auth.uid();
  end if;
  return null;
end;
$$;
revoke all on function public.current_app_owner() from public, anon;
grant execute on function public.current_app_owner() to authenticated;

alter table public.vehicles drop constraint vehicles_owner_id_fkey;
alter table public.vehicles add constraint vehicles_owner_id_fkey
  foreign key (owner_id) references app_private.app_users(id) on delete cascade;
alter table public.vehicles alter column owner_id set default public.current_app_owner();
alter policy vehicles_select_owner on public.vehicles using ((select public.current_app_owner()) = owner_id);
alter policy vehicles_insert_owner on public.vehicles with check ((select public.current_app_owner()) = owner_id);
alter policy vehicles_update_owner on public.vehicles using ((select public.current_app_owner()) = owner_id) with check ((select public.current_app_owner()) = owner_id);
alter policy vehicles_delete_owner on public.vehicles using ((select public.current_app_owner()) = owner_id);
alter policy maintenance_owner_select on public.vehicle_maintenance_items using (
  exists (select 1 from public.vehicles v where v.id = vehicle_id and v.owner_id = (select public.current_app_owner()))
);
alter policy maintenance_owner_insert on public.vehicle_maintenance_items with check (
  exists (select 1 from public.vehicles v where v.id = vehicle_id and v.owner_id = (select public.current_app_owner()))
);
alter policy maintenance_owner_update on public.vehicle_maintenance_items using (
  exists (select 1 from public.vehicles v where v.id = vehicle_id and v.owner_id = (select public.current_app_owner()))
) with check (
  exists (select 1 from public.vehicles v where v.id = vehicle_id and v.owner_id = (select public.current_app_owner()))
);
alter policy maintenance_owner_delete on public.vehicle_maintenance_items using (
  exists (select 1 from public.vehicles v where v.id = vehicle_id and v.owner_id = (select public.current_app_owner()))
);
-- Verified catalogs are also restricted to a recognized application identity.
alter policy templates_verified_read on public.maintenance_templates using (verified and (select public.current_app_owner()) is not null);
commit;
