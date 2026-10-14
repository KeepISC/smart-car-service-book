begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Shop roles supplement the stable application identity; JWT roles stay authenticated.
create table app_private.repair_shops (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  created_at timestamptz not null default clock_timestamp()
);
create table app_private.repair_shop_staff (
  shop_id uuid not null references app_private.repair_shops(id),
  user_id uuid not null references app_private.app_users(id),
  role text check (role in ('admin', 'mechanic')),
  active boolean not null default false,
  check (not active or role is not null),
  primary key (shop_id, user_id)
);
create index repair_shop_staff_user_idx on app_private.repair_shop_staff(user_id, shop_id);
create table app_private.vehicle_shop_authorizations (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references app_private.repair_shops(id),
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  ownership_epoch bigint not null check (ownership_epoch >= 0),
  initiated_by text not null check (initiated_by in ('owner', 'shop')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'revoked')),
  approved_by uuid references app_private.app_users(id),
  can_create_records boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  approved_at timestamptz,
  revoked_at timestamptz,
  check ((approved_by is null) = (approved_at is null)),
  check (status <> 'pending' or (approved_by is null and not can_create_records)),
  check (status <> 'approved' or approved_by is not null),
  check ((status = 'revoked') = (revoked_at is not null))
);
create unique index vehicle_shop_one_open_idx
  on app_private.vehicle_shop_authorizations(vehicle_id, shop_id, ownership_epoch)
  where status in ('pending', 'approved');
create index vehicle_shop_shop_idx on app_private.vehicle_shop_authorizations(shop_id, vehicle_id);
-- Immutable provenance, independent of mutable workshop labels or staff membership.
create table app_private.repair_shop_service_records (
  visit_id uuid primary key references public.service_visits(id) on delete cascade,
  authorization_id uuid not null references app_private.vehicle_shop_authorizations(id) on delete cascade,
  shop_id uuid not null references app_private.repair_shops(id),
  author_id uuid not null references app_private.app_users(id)
);
alter table app_private.repair_shops enable row level security;
alter table app_private.repair_shops force row level security;
alter table app_private.repair_shop_staff enable row level security;
alter table app_private.repair_shop_staff force row level security;
alter table app_private.vehicle_shop_authorizations enable row level security;
alter table app_private.vehicle_shop_authorizations force row level security;
alter table app_private.repair_shop_service_records enable row level security;
alter table app_private.repair_shop_service_records force row level security;
revoke all on app_private.repair_shops, app_private.repair_shop_staff,
  app_private.vehicle_shop_authorizations, app_private.repair_shop_service_records from public, anon, authenticated;

create function app_private.repair_shop_actor() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := public.current_app_owner();
begin
  if actor is null or not exists (
    select 1 from app_private.firebase_config f
    where auth.jwt()->>'iss' = 'https://securetoken.google.com/' || f.project_id
      and auth.jwt()->>'aud' = f.project_id
  ) then
    raise exception 'A recognized Firebase identity is required' using errcode = '42501';
  end if;
  return actor;
end;
$$;

-- Mutations create a shop row version. Reads hold SHARE until transaction end.
-- Removal/demotion cannot race a customer operation; stale RR/SERIALIZABLE
-- snapshots fail with 40001. Customer operations always lock vehicle BEFORE shop.
create function app_private.lock_repair_shop(p_shop_id uuid, p_admin boolean, p_write boolean)
returns app_private.repair_shops language plpgsql security definer set search_path = '' as $$
declare shop app_private.repair_shops; actor uuid := app_private.repair_shop_actor();
begin
  if p_write then
    update app_private.repair_shops s set name = s.name where s.id = p_shop_id returning s.* into shop;
  else
    select s.* into shop from app_private.repair_shops s where s.id = p_shop_id for share;
  end if;
  if shop.id is null or not exists (
    select 1 from app_private.repair_shop_staff m
    where m.shop_id = p_shop_id and m.user_id = actor and m.active
      and (not p_admin or m.role = 'admin')
  ) then
    raise exception 'Shop is unavailable or access is denied' using errcode = '42501';
  end if;
  return shop;
end;
$$;

create function public.create_repair_shop(p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare actor uuid := app_private.repair_shop_actor(); shop_id uuid;
begin
  insert into app_private.repair_shops(name) values (btrim(p_name)) returning id into shop_id;
  insert into app_private.repair_shop_staff(shop_id, user_id, role, active) values (shop_id, actor, 'admin', true);
  return shop_id;
end;
$$;

-- Self-request plus admin approval avoids accepting a frontend-selected identity.
-- No invitation tokens, email lookup, or user directory are introduced.
create function public.request_repair_shop_membership(p_shop_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare actor uuid := app_private.repair_shop_actor();
begin
  update app_private.repair_shops s set name = s.name where s.id = p_shop_id;
  if not found then raise exception 'Shop is unavailable' using errcode = '42501'; end if;
  insert into app_private.repair_shop_staff(shop_id, user_id) values (p_shop_id, actor)
    on conflict (shop_id, user_id) do update set role = null, active = false
      where not repair_shop_staff.active;
end;
$$;

create function public.set_repair_shop_staff(p_shop_id uuid, p_member_id uuid, p_role text) returns void
language plpgsql security definer set search_path = '' as $$
declare member app_private.repair_shop_staff;
begin
  perform app_private.lock_repair_shop(p_shop_id, true, true);
  if p_role is not null and p_role not in ('admin', 'mechanic') then
    raise exception 'Choose admin, mechanic or removal' using errcode = '22023';
  end if;
  select m.* into member from app_private.repair_shop_staff m
    where m.shop_id = p_shop_id and m.user_id = p_member_id;
  if not found then raise exception 'Staff request is unavailable' using errcode = '42501'; end if;
  if member.active and member.role = 'admin' and p_role is distinct from 'admin'
    and not exists (select 1 from app_private.repair_shop_staff m
      where m.shop_id = p_shop_id and m.active and m.role = 'admin' and m.user_id <> p_member_id) then
    raise exception 'A shop must retain an administrator' using errcode = '23514';
  end if;
  update app_private.repair_shop_staff set role = p_role, active = p_role is not null
    where shop_id = p_shop_id and user_id = p_member_id;
end;
$$;

create function public.list_repair_shops() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid := app_private.repair_shop_actor();
begin
  return (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'role', m.role)
    order by s.id), '[]'::jsonb) from app_private.repair_shops s
    join app_private.repair_shop_staff m on m.shop_id = s.id where m.user_id = actor and m.active);
end;
$$;

create function public.list_repair_shop_staff(p_shop_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.lock_repair_shop(p_shop_id, true, false);
  return (select coalesce(jsonb_agg(jsonb_build_object('user_id', m.user_id, 'role', m.role, 'active', m.active)
    order by m.user_id), '[]'::jsonb) from app_private.repair_shop_staff m where m.shop_id = p_shop_id);
end;
$$;

create function public.request_vehicle_shop_authorization(p_vehicle_id uuid, p_shop_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare actor uuid := app_private.repair_shop_actor(); vehicle public.vehicles; authorization_id uuid;
begin
  select v.* into vehicle from public.vehicles v where v.id = p_vehicle_id for update;
  if not found then raise exception 'Vehicle is unavailable or access is denied' using errcode = '42501'; end if;
  if vehicle.owner_id = actor then
    perform 1 from app_private.repair_shops s where s.id = p_shop_id for share;
    if not found then raise exception 'Shop is unavailable' using errcode = '42501'; end if;
  else
    perform app_private.lock_repair_shop(p_shop_id, true, false);
  end if;
  insert into app_private.vehicle_shop_authorizations(shop_id, vehicle_id, ownership_epoch, initiated_by)
    values (p_shop_id, p_vehicle_id, vehicle.ownership_epoch, case when vehicle.owner_id = actor then 'owner' else 'shop' end)
    on conflict (vehicle_id, shop_id, ownership_epoch) where status in ('pending', 'approved')
      do nothing returning id into authorization_id;
  if authorization_id is null then
    select a.id into authorization_id from app_private.vehicle_shop_authorizations a
      where a.vehicle_id = p_vehicle_id and a.shop_id = p_shop_id
        and a.ownership_epoch = vehicle.ownership_epoch and a.status in ('pending', 'approved');
  end if;
  return authorization_id;
end;
$$;

create function public.approve_vehicle_shop_authorization(p_vehicle_id uuid, p_authorization_id uuid, p_can_create_records boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := app_private.repair_shop_actor(); vehicle public.vehicles;
begin
  -- Row-version boundary also protects stale stronger-isolation approvals.
  update public.vehicles v set mileage = v.mileage
    where v.id = p_vehicle_id and v.owner_id = actor returning v.* into vehicle;
  if not found then raise exception 'Vehicle is unavailable or access is denied' using errcode = '42501'; end if;
  if p_can_create_records is null then raise exception 'Choose record creation permission' using errcode = '22023'; end if;
  update app_private.vehicle_shop_authorizations a
    set status = 'approved', approved_by = actor, approved_at = clock_timestamp(), can_create_records = p_can_create_records
    where a.id = p_authorization_id and a.vehicle_id = p_vehicle_id
      and a.ownership_epoch = vehicle.ownership_epoch and a.status = 'pending';
  if not found then raise exception 'Authorization is unavailable' using errcode = '42501'; end if;
end;
$$;

create function public.revoke_vehicle_shop_authorization(p_vehicle_id uuid, p_authorization_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare actor uuid := app_private.repair_shop_actor(); vehicle public.vehicles; grant_record app_private.vehicle_shop_authorizations;
begin
  update public.vehicles v set mileage = v.mileage where v.id = p_vehicle_id returning v.* into vehicle;
  if not found then raise exception 'Vehicle is unavailable or access is denied' using errcode = '42501'; end if;
  select a.* into grant_record from app_private.vehicle_shop_authorizations a
    where a.id = p_authorization_id and a.vehicle_id = p_vehicle_id and a.ownership_epoch = vehicle.ownership_epoch;
  if not found then raise exception 'Authorization is unavailable' using errcode = '42501'; end if;
  if vehicle.owner_id <> actor then perform app_private.lock_repair_shop(grant_record.shop_id, true, false); end if;
  update app_private.vehicle_shop_authorizations set status = 'revoked', revoked_at = clock_timestamp()
    where id = p_authorization_id and status in ('pending', 'approved');
  if not found then raise exception 'Authorization is unavailable' using errcode = '42501'; end if;
end;
$$;

create function public.list_vehicle_shop_authorizations(p_vehicle_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid := app_private.repair_shop_actor(); vehicle public.vehicles;
begin
  select v.* into vehicle from public.vehicles v where v.id = p_vehicle_id and v.owner_id = actor for share;
  if not found then raise exception 'Vehicle is unavailable or access is denied' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'shop_id', a.shop_id, 'shop_name', s.name,
    'vehicle_id', a.vehicle_id, 'ownership_epoch', a.ownership_epoch, 'initiated_by', a.initiated_by,
    'status', a.status, 'can_create_records', a.can_create_records) order by a.created_at, a.id), '[]'::jsonb)
    from app_private.vehicle_shop_authorizations a join app_private.repair_shops s on s.id = a.shop_id
    where a.vehicle_id = p_vehicle_id and a.ownership_epoch = vehicle.ownership_epoch);
end;
$$;

create function public.list_repair_shop_authorizations(p_shop_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  -- Discovery is not a capability: get/create recheck and lock the vehicle.
  perform app_private.lock_repair_shop(p_shop_id, false, false);
  return (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'shop_id', a.shop_id, 'shop_name', s.name,
    'vehicle_id', a.vehicle_id, 'ownership_epoch', a.ownership_epoch, 'initiated_by', a.initiated_by,
    'status', a.status, 'can_create_records', a.can_create_records) order by a.created_at, a.id), '[]'::jsonb)
    from app_private.vehicle_shop_authorizations a join public.vehicles v on v.id = a.vehicle_id
    join app_private.repair_shops s on s.id = a.shop_id
    where a.shop_id = p_shop_id and a.ownership_epoch = v.ownership_epoch
      and (a.status <> 'approved' or a.approved_by = v.owner_id));
end;
$$;

create function app_private.lock_shop_vehicle(p_shop_id uuid, p_vehicle_id uuid, p_create boolean)
returns app_private.vehicle_shop_authorizations language plpgsql security definer set search_path = '' as $$
declare vehicle public.vehicles; grant_record app_private.vehicle_shop_authorizations;
begin
  if p_create then
    -- Match existing Service History mileage/serialization guards.
    update public.vehicles v set mileage = v.mileage where v.id = p_vehicle_id returning v.* into vehicle;
  else
    select v.* into vehicle from public.vehicles v where v.id = p_vehicle_id for share;
  end if;
  if vehicle.id is null then raise exception 'Vehicle is unavailable or access is denied' using errcode = '42501'; end if;
  perform app_private.lock_repair_shop(p_shop_id, false, false);
  select a.* into grant_record from app_private.vehicle_shop_authorizations a
    where a.shop_id = p_shop_id and a.vehicle_id = p_vehicle_id and a.status = 'approved'
      and a.ownership_epoch = vehicle.ownership_epoch and a.approved_by = vehicle.owner_id
      and (not p_create or a.can_create_records);
  if not found then raise exception 'Vehicle is unavailable or access is denied' using errcode = '42501'; end if;
  return grant_record;
end;
$$;

create function public.get_repair_shop_vehicle(p_shop_id uuid, p_vehicle_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.lock_shop_vehicle(p_shop_id, p_vehicle_id, false);
  -- Explicit projection excludes owner identity, plate/VIN, costs and ALL owner
  -- free text (including shared text). Completion facts remain usable privately.
  return (select jsonb_build_object('vehicle', jsonb_build_object('id', v.id, 'type', v.type,
    'make', v.make, 'model', v.model, 'year', v.year, 'engine', v.engine, 'mileage', v.mileage),
    'maintenance_schedules', coalesce((select jsonb_agg(jsonb_build_object('id', m.id,
      'interval_km', m.interval_km, 'interval_months', m.interval_months, 'enabled', m.enabled,
      'history_status', m.history_status, 'last_completed_date', m.last_completed_date,
      'last_completed_mileage', m.last_completed_mileage) order by m.id)
      from public.vehicle_maintenance_items m where m.vehicle_id = v.id), '[]'::jsonb),
    'maintenance_records', coalesce((select jsonb_agg(jsonb_build_object('id', sv.id,
      'service_date', sv.service_date, 'mileage', sv.mileage,
      'operations', coalesce((select jsonb_agg(jsonb_build_object('maintenance_item_id', so.maintenance_item_id,
        'next_interval_km', so.next_interval_km, 'next_interval_months', so.next_interval_months) order by so.id)
        from public.service_operations so where so.service_visit_id = sv.id), '[]'::jsonb))
      order by sv.service_date desc, sv.mileage desc, sv.created_at desc, sv.id desc)
      from public.service_visits sv where sv.vehicle_id = v.id), '[]'::jsonb))
    from public.vehicles v where v.id = p_vehicle_id);
end;
$$;

create function public.create_repair_shop_service_visit(p_shop_id uuid, p_vehicle_id uuid, p_payload jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  grant_record app_private.vehicle_shop_authorizations;
  visit_id uuid; operation jsonb; schedule_id uuid; visit_cost numeric; operation_cost numeric; shop_name text;
begin
  grant_record := app_private.lock_shop_vehicle(p_shop_id, p_vehicle_id, true);
  if jsonb_typeof(p_payload) is distinct from 'object'
    or (p_payload - array['service_date', 'mileage', 'notes', 'total_cost', 'operations']) <> '{}'::jsonb
    or jsonb_typeof(p_payload->'operations') is distinct from 'array' then
    raise exception 'Invalid shop service payload' using errcode = '22023';
  end if;
  if jsonb_array_length(p_payload->'operations') not between 1 and 50
    or coalesce(p_payload->>'service_date', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or coalesce(p_payload->>'mileage', '') !~ '^[0-9]{1,8}$' then
    raise exception 'A dated service with mileage and 1 to 50 operations is required' using errcode = '22023';
  end if;
  visit_cost := (p_payload->>'total_cost')::numeric;
  if visit_cost is not null and (visit_cost < 0 or visit_cost > 999999999.99 or visit_cost <> trunc(visit_cost, 2)) then
    raise exception 'Invalid service cost' using errcode = '23514';
  end if;
  -- Vehicle -> shop -> schedules -> visit/operations. Never alter schedules or
  -- owner mileage. Reject cross-vehicle links before inserting any completion.
  for schedule_id in select distinct (o->>'maintenance_item_id')::uuid
    from jsonb_array_elements(p_payload->'operations') o where o->>'maintenance_item_id' is not null
    order by 1
  loop
    perform 1 from public.vehicle_maintenance_items m where m.id = schedule_id and m.vehicle_id = p_vehicle_id for key share;
    if not found then raise exception 'Maintenance item is unavailable' using errcode = '42501'; end if;
  end loop;
  select s.name into shop_name from app_private.repair_shops s where s.id = p_shop_id;
  insert into public.service_visits(vehicle_id, service_date, mileage, service_type, workshop_name, total_cost, notes)
    values (p_vehicle_id, (p_payload->>'service_date')::date, (p_payload->>'mileage')::integer,
      'workshop', shop_name, visit_cost, nullif(btrim(p_payload->>'notes'), '')) returning id into visit_id;
  for operation in select value from jsonb_array_elements(p_payload->'operations')
  loop
    if jsonb_typeof(operation) is distinct from 'object'
      or (operation - array['maintenance_item_id', 'operation_name', 'cost']) <> '{}'::jsonb then
      raise exception 'Invalid shop operation payload' using errcode = '22023';
    end if;
    operation_cost := (operation->>'cost')::numeric;
    if operation_cost is not null and (operation_cost < 0 or operation_cost > 999999999.99 or operation_cost <> trunc(operation_cost, 2)) then
      raise exception 'Invalid operation cost' using errcode = '23514';
    end if;
    insert into public.service_operations(service_visit_id, maintenance_item_id, operation_name, cost)
      values (visit_id, (operation->>'maintenance_item_id')::uuid, btrim(operation->>'operation_name'), operation_cost);
  end loop;
  insert into app_private.repair_shop_service_records(visit_id, authorization_id, shop_id, author_id)
    values (visit_id, grant_record.id, p_shop_id, app_private.repair_shop_actor());
  return visit_id;
end;
$$;

revoke all on function app_private.repair_shop_actor(), app_private.lock_repair_shop(uuid, boolean, boolean),
  app_private.lock_shop_vehicle(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.create_repair_shop(text), public.request_repair_shop_membership(uuid),
  public.set_repair_shop_staff(uuid, uuid, text), public.list_repair_shops(), public.list_repair_shop_staff(uuid),
  public.request_vehicle_shop_authorization(uuid, uuid), public.approve_vehicle_shop_authorization(uuid, uuid, boolean),
  public.revoke_vehicle_shop_authorization(uuid, uuid), public.list_vehicle_shop_authorizations(uuid),
  public.list_repair_shop_authorizations(uuid), public.get_repair_shop_vehicle(uuid, uuid),
  public.create_repair_shop_service_visit(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.create_repair_shop(text), public.request_repair_shop_membership(uuid),
  public.set_repair_shop_staff(uuid, uuid, text), public.list_repair_shops(), public.list_repair_shop_staff(uuid),
  public.request_vehicle_shop_authorization(uuid, uuid), public.approve_vehicle_shop_authorization(uuid, uuid, boolean),
  public.revoke_vehicle_shop_authorization(uuid, uuid), public.list_vehicle_shop_authorizations(uuid),
  public.list_repair_shop_authorizations(uuid), public.get_repair_shop_vehicle(uuid, uuid),
  public.create_repair_shop_service_visit(uuid, uuid, jsonb) to authenticated;
notify pgrst, 'reload schema';
commit;
