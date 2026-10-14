begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Entitlements start pending, including existing shops: never invent a paid plan.
-- Owners retain their vehicles and all existing completion/history records.
alter table app_private.repair_shops
  add column suspended boolean not null default false,
  add column logo_reference text check (logo_reference is null or
    (char_length(logo_reference) <= 512 and logo_reference ~ '^[a-zA-Z0-9][a-zA-Z0-9/_.-]*$')),
  add column primary_color text check (primary_color ~ '^#[0-9a-fA-F]{6}$'),
  add column secondary_color text check (secondary_color ~ '^#[0-9a-fA-F]{6}$'),
  add column contact_email text check (contact_email is null or
    (char_length(contact_email) <= 254 and contact_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')),
  add column contact_phone text check (contact_phone is null or
    (char_length(contact_phone) between 1 and 40 and contact_phone !~ '[[:cntrl:]]')),
  add column contact_address text check (contact_address is null or
    (char_length(contact_address) between 1 and 500 and contact_address !~ '[[:cntrl:]]')),
  add column contact_website text check (contact_website is null or
    (char_length(contact_website) <= 512 and contact_website ~ '^https://[a-zA-Z0-9.-]+(:[0-9]+)?(/[^[:space:]]*)?$')),
  add column plan_code text not null default 'manual' check (plan_code ~ '^[a-z0-9][a-z0-9_-]{0,39}$'),
  add column subscription_status text not null default 'pending' check (subscription_status in ('pending', 'active', 'disabled')),
  add column subscription_starts_at timestamptz,
  add column subscription_ends_at timestamptz,
  add column max_active_staff integer check (max_active_staff >= 0),
  add column max_connected_vehicles integer check (max_connected_vehicles >= 0),
  add column max_monthly_records integer check (max_monthly_records >= 0),
  add constraint shop_subscription_dates check (
    (subscription_starts_at is null or isfinite(subscription_starts_at)) and
    (subscription_ends_at is null or isfinite(subscription_ends_at)) and
    (subscription_starts_at is null or subscription_ends_at is null or subscription_ends_at > subscription_starts_at) and
    (subscription_status <> 'active' or (subscription_starts_at is not null and subscription_ends_at is not null))
  );

-- Quota timestamps use wall-clock creation, not a long transaction's start time.
-- Preserve historical provenance dates rather than assigning migration time.
alter table app_private.repair_shop_service_records add column recorded_at timestamptz;
update app_private.repair_shop_service_records r set recorded_at = sv.created_at
  from public.service_visits sv where sv.id = r.visit_id;
alter table app_private.repair_shop_service_records alter column recorded_at set not null;
alter table app_private.repair_shop_service_records alter column recorded_at set default clock_timestamp();

create table app_private.platform_administrators (
  user_id uuid primary key references app_private.app_users(id),
  active boolean not null default false
);
create table app_private.platform_shop_audit (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default clock_timestamp(),
  actor_id uuid references app_private.app_users(id),
  executor text not null,
  shop_id uuid references app_private.repair_shops(id),
  action text not null,
  reason text not null check (char_length(btrim(reason)) between 1 and 1000),
  before_state jsonb,
  after_state jsonb
);
create index platform_shop_audit_shop_idx on app_private.platform_shop_audit(shop_id, occurred_at desc, id);
alter table app_private.platform_administrators enable row level security;
alter table app_private.platform_administrators force row level security;
alter table app_private.platform_shop_audit enable row level security;
alter table app_private.platform_shop_audit force row level security;
revoke all on app_private.platform_administrators, app_private.platform_shop_audit from public, anon, authenticated;

create function app_private.lock_platform_administrator() returns uuid
language plpgsql security definer set search_path = '' as $$
declare actor uuid := app_private.repair_shop_actor();
begin
  perform 1 from app_private.platform_administrators a where a.user_id = actor and a.active for share;
  if not found then raise exception 'Platform administration access is denied' using errcode = '42501'; end if;
  return actor;
end;
$$;

create function app_private.audit_platform_shop_change(p_actor uuid, p_shop uuid, p_action text, p_reason text, p_before jsonb, p_after jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into app_private.platform_shop_audit(actor_id, executor, shop_id, action, reason, before_state, after_state)
    values (p_actor, session_user, p_shop, p_action, btrim(p_reason), p_before, p_after);
end;
$$;

-- Trusted operator only, not exposed through PostgREST or any client grant.
-- Resolve the UID through the existing mapping; never bootstrap by email/JWT role.
create function app_private.set_platform_administrator(p_firebase_uid text, p_enabled boolean, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare target uuid; previous jsonb;
begin
  if p_enabled is null then raise exception 'Choose administrator access' using errcode = '22023'; end if;
  select f.owner_id into target from app_private.firebase_identities f
    join app_private.firebase_provisioning_approvals a using (firebase_uid)
    where f.firebase_uid = p_firebase_uid and (not p_enabled or a.enabled);
  if not found then raise exception 'Recognized Firebase identity is unavailable' using errcode = '42501'; end if;
  -- Upsert first serializes concurrent bootstrap/revocation of this identity.
  insert into app_private.platform_administrators(user_id) values (target) on conflict do nothing;
  select to_jsonb(a) into previous from app_private.platform_administrators a where a.user_id = target for update;
  update app_private.platform_administrators set active = p_enabled where user_id = target;
  perform app_private.audit_platform_shop_change(null, null, 'platform_administrator', p_reason, previous,
    jsonb_build_object('user_id', target, 'active', p_enabled));
end;
$$;

create function app_private.require_shop_access(p_shop_id uuid, p_write boolean default false)
returns app_private.repair_shops language plpgsql security definer set search_path = '' as $$
declare shop app_private.repair_shops;
begin
  if p_write then
    -- Serialize capacity decisions and conflict with stale stronger snapshots.
    update app_private.repair_shops s set name = s.name where s.id = p_shop_id returning s.* into shop;
  else
    select s.* into shop from app_private.repair_shops s where s.id = p_shop_id for share;
  end if;
  if shop.id is null or shop.suspended or shop.subscription_status <> 'active'
    or shop.subscription_starts_at > clock_timestamp() or shop.subscription_ends_at <= clock_timestamp() then
    raise exception 'Shop access is unavailable' using errcode = '42501';
  end if;
  return shop;
end;
$$;

create or replace function app_private.lock_repair_shop(p_shop_id uuid, p_admin boolean, p_write boolean)
returns app_private.repair_shops language plpgsql security definer set search_path = '' as $$
declare shop app_private.repair_shops; actor uuid := app_private.repair_shop_actor();
begin
  shop := app_private.require_shop_access(p_shop_id, p_write);
  if not exists (select 1 from app_private.repair_shop_staff m
    where m.shop_id = p_shop_id and m.user_id = actor and m.active and (not p_admin or m.role = 'admin')) then
    raise exception 'Shop is unavailable or access is denied' using errcode = '42501';
  end if;
  return shop;
end;
$$;

create function app_private.check_shop_staff_capacity(p_shop_id uuid, p_member_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare capacity integer;
begin
  select s.max_active_staff into capacity from app_private.repair_shops s where s.id = p_shop_id;
  if capacity is not null and not exists (select 1 from app_private.repair_shop_staff m
    where m.shop_id = p_shop_id and m.user_id = p_member_id and m.active)
    and (select count(*) from app_private.repair_shop_staff m where m.shop_id = p_shop_id and m.active) >= capacity then
    raise exception 'Shop staff limit has been reached' using errcode = '23514';
  end if;
end;
$$;

create function app_private.write_shop_profile(p_shop_id uuid, p_profile jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if jsonb_typeof(p_profile) is distinct from 'object' or
    (p_profile - array['business_name','logo_reference','primary_color','secondary_color','contact_email','contact_phone','contact_address','contact_website']) <> '{}'::jsonb
    or exists (select 1 from jsonb_each(p_profile) f where jsonb_typeof(f.value) not in ('string','null')) then
    raise exception 'Invalid shop profile' using errcode = '22023';
  end if;
  update app_private.repair_shops set name = btrim(p_profile->>'business_name'),
    logo_reference = nullif(btrim(p_profile->>'logo_reference'), ''), primary_color = p_profile->>'primary_color',
    secondary_color = p_profile->>'secondary_color', contact_email = nullif(btrim(p_profile->>'contact_email'), ''),
    contact_phone = nullif(btrim(p_profile->>'contact_phone'), ''), contact_address = nullif(btrim(p_profile->>'contact_address'), ''),
    contact_website = nullif(btrim(p_profile->>'contact_website'), '') where id = p_shop_id;
end;
$$;

create function public.is_platform_administrator() returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  return exists (select 1 from app_private.platform_administrators a
    where a.user_id = public.current_app_owner() and a.active) and exists (
      select 1 from app_private.firebase_config f where auth.jwt()->>'iss' = 'https://securetoken.google.com/' || f.project_id);
end;
$$;

create function public.platform_create_repair_shop(p_profile jsonb, p_reason text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare actor uuid := app_private.lock_platform_administrator(); shop_id uuid; shop app_private.repair_shops;
begin
  insert into app_private.repair_shops(name) values (btrim(p_profile->>'business_name')) returning id into shop_id;
  perform app_private.write_shop_profile(shop_id, p_profile);
  select s.* into shop from app_private.repair_shops s where s.id = shop_id;
  perform app_private.audit_platform_shop_change(actor, shop_id, 'create_shop', p_reason, null, to_jsonb(shop));
  return shop_id;
end;
$$;

create function public.platform_update_repair_shop(p_shop_id uuid, p_profile jsonb, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare actor uuid := app_private.lock_platform_administrator(); previous jsonb; updated jsonb;
begin
  select to_jsonb(s) into previous from app_private.repair_shops s where s.id = p_shop_id for update;
  if not found then raise exception 'Shop is unavailable' using errcode = '42501'; end if;
  perform app_private.write_shop_profile(p_shop_id, p_profile);
  select to_jsonb(s) into updated from app_private.repair_shops s where s.id = p_shop_id;
  perform app_private.audit_platform_shop_change(actor, p_shop_id, 'update_profile', p_reason, previous, updated);
end;
$$;

create function public.platform_set_shop_suspension(p_shop_id uuid, p_suspended boolean, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare actor uuid := app_private.lock_platform_administrator(); previous jsonb; updated jsonb;
begin
  if p_suspended is null then raise exception 'Choose suspension status' using errcode = '22023'; end if;
  select to_jsonb(s) into previous from app_private.repair_shops s where s.id = p_shop_id for update;
  if not found then raise exception 'Shop is unavailable' using errcode = '42501'; end if;
  update app_private.repair_shops set suspended = p_suspended where id = p_shop_id returning to_jsonb(repair_shops) into updated;
  perform app_private.audit_platform_shop_change(actor, p_shop_id, case when p_suspended then 'suspend_shop' else 'reactivate_shop' end,
    p_reason, previous, updated);
end;
$$;

create function public.platform_set_shop_subscription(p_shop_id uuid, p_subscription jsonb, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare actor uuid := app_private.lock_platform_administrator(); previous jsonb; updated jsonb; limits jsonb;
begin
  if jsonb_typeof(p_subscription) is distinct from 'object' or
    (p_subscription - array['plan_code','status','starts_at','ends_at','limits']) <> '{}'::jsonb then
    raise exception 'Invalid shop subscription' using errcode = '22023';
  end if;
  limits := p_subscription->'limits';
  if jsonb_typeof(limits) is distinct from 'object' or
    (limits - array['max_active_staff','max_connected_vehicles','max_monthly_records']) <> '{}'::jsonb or
    exists (select 1 from jsonb_each(limits) f where jsonb_typeof(f.value) <> 'null' and
      (jsonb_typeof(f.value) <> 'number' or f.value::text !~ '^[0-9]+$')) then
    raise exception 'Invalid shop subscription limits' using errcode = '22023';
  end if;
  select to_jsonb(s) into previous from app_private.repair_shops s where s.id = p_shop_id for update;
  if not found then raise exception 'Shop is unavailable' using errcode = '42501'; end if;
  update app_private.repair_shops set plan_code = p_subscription->>'plan_code', subscription_status = p_subscription->>'status',
    subscription_starts_at = (p_subscription->>'starts_at')::timestamptz, subscription_ends_at = (p_subscription->>'ends_at')::timestamptz,
    max_active_staff = (limits->>'max_active_staff')::integer,
    max_connected_vehicles = (limits->>'max_connected_vehicles')::integer,
    max_monthly_records = (limits->>'max_monthly_records')::integer
    where id = p_shop_id returning to_jsonb(repair_shops) into updated;
  perform app_private.audit_platform_shop_change(actor, p_shop_id, 'set_subscription', p_reason, previous, updated);
end;
$$;

create function public.platform_set_shop_administrator(p_shop_id uuid, p_firebase_uid text, p_enabled boolean, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare actor uuid := app_private.lock_platform_administrator(); target uuid; previous jsonb; updated jsonb;
begin
  if p_enabled is null then raise exception 'Choose administrator access' using errcode = '22023'; end if;
  -- A lock alone cannot invalidate REPEATABLE READ staff snapshots. Advance the
  -- same shop row version used by ordinary staff removal and capacity allocation.
  update app_private.repair_shops s set name = s.name where s.id = p_shop_id;
  if not found then raise exception 'Shop is unavailable' using errcode = '42501'; end if;
  select f.owner_id into target from app_private.firebase_identities f join app_private.firebase_provisioning_approvals a using (firebase_uid)
    where f.firebase_uid = p_firebase_uid and (not p_enabled or a.enabled);
  if not found then raise exception 'Recognized Firebase identity is unavailable' using errcode = '42501'; end if;
  select to_jsonb(m) into previous from app_private.repair_shop_staff m where m.shop_id = p_shop_id and m.user_id = target;
  if p_enabled then
    perform app_private.check_shop_staff_capacity(p_shop_id, target);
    insert into app_private.repair_shop_staff(shop_id, user_id, role, active) values (p_shop_id, target, 'admin', true)
      on conflict (shop_id, user_id) do update set role = 'admin', active = true;
  else
    -- Platform recovery may remove the last shop admin; shop admins cannot.
    update app_private.repair_shop_staff set role = null, active = false
      where shop_id = p_shop_id and user_id = target and role = 'admin' and active;
    if not found then raise exception 'Active shop administrator is unavailable' using errcode = '42501'; end if;
  end if;
  select to_jsonb(m) into updated from app_private.repair_shop_staff m where m.shop_id = p_shop_id and m.user_id = target;
  perform app_private.audit_platform_shop_change(actor, p_shop_id, case when p_enabled then 'assign_shop_admin' else 'revoke_shop_admin' end,
    p_reason, previous, updated);
end;
$$;

create function public.platform_list_repair_shops(p_offset integer default 0, p_limit integer default 100) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.lock_platform_administrator();
  if p_offset is null or p_offset < 0 or p_limit is null or p_limit not between 1 and 200 then
    raise exception 'Invalid page' using errcode = '22023'; end if;
  return (select coalesce(jsonb_agg(to_jsonb(s) || jsonb_build_object('access_status',
    case when s.suspended then 'suspended' when s.subscription_status <> 'active' then s.subscription_status
      when s.subscription_starts_at > clock_timestamp() then 'not_started'
      when s.subscription_ends_at <= clock_timestamp() then 'expired' else 'active' end) order by s.id), '[]'::jsonb)
    from (select * from app_private.repair_shops order by id offset p_offset limit p_limit) s);
end;
$$;

create function public.platform_list_shop_audit(p_shop_id uuid default null, p_offset integer default 0, p_limit integer default 100) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.lock_platform_administrator();
  if p_offset is null or p_offset < 0 or p_limit is null or p_limit not between 1 and 200 then
    raise exception 'Invalid page' using errcode = '22023'; end if;
  return (select coalesce(jsonb_agg(to_jsonb(a) order by a.occurred_at desc, a.id), '[]'::jsonb)
    from (select * from app_private.platform_shop_audit where p_shop_id is null or shop_id = p_shop_id
      order by occurred_at desc, id offset p_offset limit p_limit) a);
end;
$$;

-- Move established implementations behind inaccessible delegates, preserving
-- their ownership/epoch/validation logic. Public wrappers add entitlements/limits.
alter function public.request_vehicle_shop_authorization(uuid, uuid) rename to base_request_vehicle_shop_authorization;
alter function public.base_request_vehicle_shop_authorization(uuid, uuid) set schema app_private;
alter function public.approve_vehicle_shop_authorization(uuid, uuid, boolean) rename to base_approve_vehicle_shop_authorization;
alter function public.base_approve_vehicle_shop_authorization(uuid, uuid, boolean) set schema app_private;
alter function public.create_repair_shop_service_visit(uuid, uuid, jsonb) rename to base_create_repair_shop_service_visit;
alter function public.base_create_repair_shop_service_visit(uuid, uuid, jsonb) set schema app_private;
alter function public.request_repair_shop_membership(uuid) rename to base_request_repair_shop_membership;
alter function public.base_request_repair_shop_membership(uuid) set schema app_private;
alter function public.set_repair_shop_staff(uuid, uuid, text) rename to base_set_repair_shop_staff;
alter function public.base_set_repair_shop_staff(uuid, uuid, text) set schema app_private;
alter function public.cancel_repair_shop_connection_invitation(uuid, uuid) rename to base_cancel_repair_shop_connection_invitation;
alter function public.base_cancel_repair_shop_connection_invitation(uuid, uuid) set schema app_private;
alter function app_private.lock_shop_connection_invitation(text) rename to base_lock_shop_connection_invitation;

create function public.request_vehicle_shop_authorization(p_vehicle_id uuid, p_shop_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare result uuid;
begin
  perform app_private.repair_shop_actor();
  perform 1 from public.vehicles where id = p_vehicle_id for update;
  perform app_private.require_shop_access(p_shop_id);
  result := app_private.base_request_vehicle_shop_authorization(p_vehicle_id, p_shop_id);
  perform app_private.require_shop_access(p_shop_id);
  return result;
end;
$$;

create function public.approve_vehicle_shop_authorization(p_vehicle_id uuid, p_authorization_id uuid, p_can_create_records boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare shop app_private.repair_shops; shop_id uuid;
begin
  perform app_private.repair_shop_actor();
  perform 1 from public.vehicles where id = p_vehicle_id for update;
  select a.shop_id into shop_id from app_private.vehicle_shop_authorizations a where a.id = p_authorization_id and a.vehicle_id = p_vehicle_id;
  if not found then raise exception 'Authorization is unavailable' using errcode = '42501'; end if;
  shop := app_private.require_shop_access(shop_id, true);
  perform app_private.base_approve_vehicle_shop_authorization(p_vehicle_id, p_authorization_id, p_can_create_records);
  if shop.max_connected_vehicles is not null and (select count(*) from app_private.vehicle_shop_authorizations a
    join public.vehicles v on v.id = a.vehicle_id where a.shop_id = shop.id and a.status = 'approved'
      and a.ownership_epoch = v.ownership_epoch and a.approved_by = v.owner_id) > shop.max_connected_vehicles then
    raise exception 'Shop connection limit has been reached' using errcode = '23514';
  end if;
  perform app_private.require_shop_access(shop_id);
end;
$$;

create function public.create_repair_shop_service_visit(p_shop_id uuid, p_vehicle_id uuid, p_payload jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare shop app_private.repair_shops; result uuid; month_start timestamptz; month_end timestamptz;
begin
  perform app_private.repair_shop_actor();
  perform 1 from public.vehicles where id = p_vehicle_id for update;
  shop := app_private.require_shop_access(p_shop_id, true);
  perform app_private.lock_shop_vehicle(p_shop_id, p_vehicle_id, true);
  month_start := date_trunc('month', clock_timestamp() at time zone 'UTC') at time zone 'UTC';
  month_end := ((month_start at time zone 'UTC') + interval '1 month') at time zone 'UTC';
  if shop.max_monthly_records is not null and (select count(*) from app_private.repair_shop_service_records r
    where r.shop_id = p_shop_id and r.recorded_at >= month_start and r.recorded_at < month_end) >= shop.max_monthly_records then
    raise exception 'Shop monthly service record limit has been reached' using errcode = '23514';
  end if;
  result := app_private.base_create_repair_shop_service_visit(p_shop_id, p_vehicle_id, p_payload);
  perform app_private.require_shop_access(p_shop_id);
  return result;
end;
$$;

create function public.request_repair_shop_membership(p_shop_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.repair_shop_actor();
  perform app_private.require_shop_access(p_shop_id, true);
  perform app_private.base_request_repair_shop_membership(p_shop_id);
  perform app_private.require_shop_access(p_shop_id);
end;
$$;

create function public.set_repair_shop_staff(p_shop_id uuid, p_member_id uuid, p_role text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.lock_repair_shop(p_shop_id, true, true);
  if p_role is not null then perform app_private.check_shop_staff_capacity(p_shop_id, p_member_id); end if;
  perform app_private.base_set_repair_shop_staff(p_shop_id, p_member_id, p_role);
  perform app_private.require_shop_access(p_shop_id);
end;
$$;

create function app_private.lock_shop_connection_invitation(p_token text)
returns app_private.repair_shop_connection_invitations language plpgsql security definer set search_path = '' as $$
declare invitation app_private.repair_shop_connection_invitations; shop_id uuid;
begin
  perform app_private.repair_shop_actor();
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    raise exception 'Invitation is unavailable or access is denied' using errcode = '42501'; end if;
  select i.shop_id into shop_id from app_private.repair_shop_connection_invitations i
    where i.token_hash = sha256(convert_to(p_token, 'UTF8'));
  if not found then raise exception 'Invitation is unavailable or access is denied' using errcode = '42501'; end if;
  -- Acceptance later consumes connection capacity: acquire the exclusive shop
  -- version before any invitation lock, avoiding SHARE-to-UPDATE upgrade races.
  perform app_private.require_shop_access(shop_id, true);
  invitation := app_private.base_lock_shop_connection_invitation(p_token);
  -- Recipient paths did not previously check shop membership: gate after token lock waits.
  perform app_private.require_shop_access(invitation.shop_id);
  return invitation;
end;
$$;

create function public.cancel_repair_shop_connection_invitation(p_shop_id uuid, p_invitation_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.base_cancel_repair_shop_connection_invitation(p_shop_id, p_invitation_id);
  perform app_private.require_shop_access(p_shop_id);
end;
$$;

create or replace function public.list_repair_shops() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid := app_private.repair_shop_actor();
begin
  return (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'role', m.role) order by s.id), '[]'::jsonb)
    from app_private.repair_shops s join app_private.repair_shop_staff m on m.shop_id = s.id
    where m.user_id = actor and m.active and not s.suspended and s.subscription_status = 'active'
      and s.subscription_starts_at <= clock_timestamp() and s.subscription_ends_at > clock_timestamp());
end;
$$;

revoke all on function app_private.lock_platform_administrator(), app_private.audit_platform_shop_change(uuid,uuid,text,text,jsonb,jsonb),
  app_private.set_platform_administrator(text,boolean,text), app_private.require_shop_access(uuid,boolean),
  app_private.check_shop_staff_capacity(uuid,uuid), app_private.write_shop_profile(uuid,jsonb),
  app_private.base_request_vehicle_shop_authorization(uuid,uuid), app_private.base_approve_vehicle_shop_authorization(uuid,uuid,boolean),
  app_private.base_create_repair_shop_service_visit(uuid,uuid,jsonb), app_private.base_request_repair_shop_membership(uuid),
  app_private.base_set_repair_shop_staff(uuid,uuid,text), app_private.base_cancel_repair_shop_connection_invitation(uuid,uuid),
  app_private.base_lock_shop_connection_invitation(text), app_private.lock_shop_connection_invitation(text)
  from public, anon, authenticated;
revoke all on function public.is_platform_administrator(), public.platform_create_repair_shop(jsonb,text),
  public.platform_update_repair_shop(uuid,jsonb,text), public.platform_set_shop_suspension(uuid,boolean,text),
  public.platform_set_shop_subscription(uuid,jsonb,text), public.platform_set_shop_administrator(uuid,text,boolean,text),
  public.platform_list_repair_shops(integer,integer), public.platform_list_shop_audit(uuid,integer,integer),
  public.request_vehicle_shop_authorization(uuid,uuid), public.approve_vehicle_shop_authorization(uuid,uuid,boolean),
  public.create_repair_shop_service_visit(uuid,uuid,jsonb), public.request_repair_shop_membership(uuid),
  public.set_repair_shop_staff(uuid,uuid,text), public.cancel_repair_shop_connection_invitation(uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.is_platform_administrator(), public.platform_create_repair_shop(jsonb,text),
  public.platform_update_repair_shop(uuid,jsonb,text), public.platform_set_shop_suspension(uuid,boolean,text),
  public.platform_set_shop_subscription(uuid,jsonb,text), public.platform_set_shop_administrator(uuid,text,boolean,text),
  public.platform_list_repair_shops(integer,integer), public.platform_list_shop_audit(uuid,integer,integer),
  public.request_vehicle_shop_authorization(uuid,uuid), public.approve_vehicle_shop_authorization(uuid,uuid,boolean),
  public.create_repair_shop_service_visit(uuid,uuid,jsonb), public.request_repair_shop_membership(uuid),
  public.set_repair_shop_staff(uuid,uuid,text), public.cancel_repair_shop_connection_invitation(uuid,uuid) to authenticated;
notify pgrst, 'reload schema';
commit;
