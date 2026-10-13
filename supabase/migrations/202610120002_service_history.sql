begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

lock table public.vehicles, public.vehicle_maintenance_items in share row exclusive mode;

create table public.service_visits (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  service_date date not null check (service_date between date '0001-01-01' and current_date),
  mileage integer not null check (mileage between 0 and 10000000),
  service_type text not null check (service_type in ('diy', 'workshop')),
  workshop_name text check (workshop_name is null or char_length(btrim(workshop_name)) between 1 and 120),
  total_cost numeric(12, 2) check (total_cost is null or total_cost between 0 and 999999999.99),
  notes text check (notes is null or char_length(notes) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (service_type = 'workshop' or workshop_name is null)
);
create index service_visits_vehicle_date_idx
  on public.service_visits(vehicle_id, service_date desc, created_at desc);

create table public.service_operations (
  id uuid primary key default gen_random_uuid(),
  service_visit_id uuid not null references public.service_visits(id) on delete cascade,
  maintenance_item_id uuid references public.vehicle_maintenance_items(id) on delete set null,
  operation_name text not null check (char_length(btrim(operation_name)) between 1 and 120),
  cost numeric(12, 2) check (cost is null or cost between 0 and 999999999.99),
  next_interval_km integer check (next_interval_km between 1 and 10000000),
  next_interval_months integer check (next_interval_months between 1 and 1200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index service_operations_visit_idx on public.service_operations(service_visit_id);
create index service_operations_maintenance_idx
  on public.service_operations(maintenance_item_id) where maintenance_item_id is not null;
create unique index service_operations_visit_schedule_idx
  on public.service_operations(service_visit_id, maintenance_item_id)
  where maintenance_item_id is not null;

alter table public.service_visits enable row level security;
alter table public.service_visits force row level security;
alter table public.service_operations enable row level security;
alter table public.service_operations force row level security;

revoke all on public.service_visits, public.service_operations from anon, authenticated;
grant select on public.service_visits, public.service_operations to authenticated;
-- Retain the existing narrow column grants for local legacy clients. The
-- completion trigger below prevents a second writer once history is linked.

create policy service_visits_owner_select on public.service_visits
  for select to authenticated using (
    exists (
      select 1 from public.vehicles v
      where v.id = vehicle_id and v.owner_id = (select public.current_app_owner())
    )
  );
create policy service_operations_owner_select on public.service_operations
  for select to authenticated using (
    exists (
      select 1
      from public.service_visits sv
      join public.vehicles v on v.id = sv.vehicle_id
      where sv.id = service_visit_id and v.owner_id = (select public.current_app_owner())
    )
  );

create or replace function public.validate_vehicle_mileage() returns trigger
language plpgsql set search_path = '' as $$
begin
  if exists (
    select 1 from public.vehicle_maintenance_items m
    where m.vehicle_id = new.id and m.last_completed_mileage > new.mileage
  ) or exists (
    select 1 from public.service_visits sv
    where sv.vehicle_id = new.id and sv.mileage > new.mileage
  ) then
    raise exception 'Vehicle mileage is below a recorded maintenance completion'
      using errcode = '23514', constraint = 'vehicle_maintenance_mileage_consistency';
  end if;
  return new;
end;
$$;
revoke all on function public.validate_vehicle_mileage() from public, anon, authenticated;

create or replace function public.validate_maintenance_completion() returns trigger
language plpgsql set search_path = '' as $$
declare current_mileage integer;
begin
  -- Keep the existing parent row-version boundary for both completion sources.
  -- Stale stronger-isolation snapshots fail with 40001 instead of missing history.
  update public.vehicles set mileage = mileage where id = new.vehicle_id
    returning mileage into current_mileage;
  if not found then
    raise exception 'Vehicle is unavailable or access is denied' using errcode = '42501';
  end if;
  if new.last_completed_mileage > current_mileage then
    raise exception 'Maintenance completion exceeds current vehicle mileage'
      using errcode = '23514', constraint = 'vehicle_maintenance_mileage_consistency';
  end if;
  if new.last_completed_date is not null
    and new.last_completed_date not between date '0001-01-01' and current_date then
    raise exception 'Completion date must be a finite supported date on or before today'
      using errcode = '23514', constraint = 'maintenance_completion_date_supported';
  end if;
  if tg_op = 'UPDATE'
    and (new.history_status, new.last_completed_date, new.last_completed_mileage)
      is distinct from (old.history_status, old.last_completed_date, old.last_completed_mileage)
    and exists (select 1 from public.service_operations so where so.maintenance_item_id = new.id) then
    raise exception 'Completion is managed by service history'
      using errcode = '23514', constraint = 'maintenance_completion_source_conflict';
  end if;
  return new;
end;
$$;
revoke all on function public.validate_maintenance_completion() from public, anon, authenticated;

create or replace function public.validate_service_visit() returns trigger
language plpgsql set search_path = '' as $$
declare current_mileage integer;
begin
  select v.mileage into current_mileage from public.vehicles v
    where v.id = new.vehicle_id for update;
  if not found then
    raise exception 'Vehicle is unavailable or access is denied' using errcode = '42501';
  end if;
  if new.mileage > current_mileage then
    raise exception 'Service mileage exceeds current vehicle mileage'
      using errcode = '23514', constraint = 'service_visit_mileage_consistency';
  end if;
  return new;
end;
$$;
revoke all on function public.validate_service_visit() from public, anon, authenticated;
create trigger service_visit_mileage_check before insert or update of vehicle_id, mileage
  on public.service_visits for each row execute function public.validate_service_visit();
create trigger service_visits_updated_at before update on public.service_visits
  for each row execute function public.set_vehicle_updated_at();
create trigger service_operations_updated_at before update on public.service_operations
  for each row execute function public.set_vehicle_updated_at();

-- SECURITY DEFINER is confined to owner-checked RPCs; table names are
-- schema-qualified and public entry points use a fixed search_path.
create function public.save_service_visit(
  p_vehicle_id uuid,
  p_visit_id uuid,
  p_payload jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  visit_date date;
  visit_mileage integer;
  visit_type text;
  workshop text;
  visit_cost numeric;
  visit_notes text;
  operation jsonb;
  operation_label text;
  schedule_id uuid;
  found_vehicle_id uuid;
  operation_cost numeric;
  interval_km integer;
  interval_months integer;
  current_owner_id uuid;
  saved_visit_id uuid;
begin
  current_owner_id := public.current_app_owner();
  if current_owner_id is null then
    raise exception 'An authenticated owner is required' using errcode = '42501';
  end if;

  -- A row version is required as well as a lock: older REPEATABLE READ
  -- snapshots must fail rather than miss this visit in the mileage guard.
  update public.vehicles v set mileage = v.mileage
    where v.id = p_vehicle_id and v.owner_id = current_owner_id
    returning v.id into found_vehicle_id;
  if not found then
    raise exception 'Vehicle is unavailable or access is denied' using errcode = '42501';
  end if;

  if p_visit_id is not null then
    perform 1 from public.service_visits sv
      where sv.id = p_visit_id and sv.vehicle_id = p_vehicle_id;
    if not found then
      raise exception 'Service visit is unavailable or access is denied' using errcode = '42501';
    end if;
  end if;

  if jsonb_typeof(p_payload) is distinct from 'object'
    or jsonb_typeof(p_payload -> 'operations') is distinct from 'array'
    or jsonb_array_length(p_payload -> 'operations') not between 1 and 50 then
    raise exception 'A service visit must contain 1 to 50 operations' using errcode = '22023';
  end if;

  if (p_payload ->> 'service_date') is null
    or (p_payload ->> 'service_date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception 'Service date must use YYYY-MM-DD' using errcode = '23514';
  end if;
  visit_date := (p_payload ->> 'service_date')::date;
  visit_mileage := (p_payload ->> 'mileage')::integer;
  visit_type := p_payload ->> 'service_type';
  workshop := nullif(btrim(p_payload ->> 'workshop_name'), '');
  visit_cost := nullif(p_payload ->> 'total_cost', '')::numeric;
  visit_notes := nullif(btrim(p_payload ->> 'notes'), '');

  if visit_date is null or visit_date < date '0001-01-01' or visit_date > current_date then
    raise exception 'Service date must be today or earlier' using errcode = '23514';
  end if;
  if visit_mileage is null or visit_mileage < 0 or visit_mileage > 10000000 then
    raise exception 'Service mileage is outside the supported range' using errcode = '23514';
  end if;
  if visit_type is null or visit_type not in ('diy', 'workshop') then
    raise exception 'Choose DIY or workshop service' using errcode = '23514';
  end if;
  if visit_type = 'diy' and workshop is not null then
    raise exception 'DIY visits cannot include a workshop name' using errcode = '23514';
  end if;
  if workshop is not null and char_length(workshop) > 120 then
    raise exception 'Workshop name must be 120 characters or fewer' using errcode = '23514';
  end if;
  if visit_notes is not null and char_length(visit_notes) > 4000 then
    raise exception 'Notes must be 4,000 characters or fewer' using errcode = '23514';
  end if;
  if visit_cost is not null
    and (visit_cost < 0 or visit_cost > 999999999.99 or visit_cost <> trunc(visit_cost, 2)) then
    raise exception 'Total cost is outside the supported precision/range' using errcode = '23514';
  end if;

  -- Lock referenced schedules before visit/operation rows. A schedule delete
  -- locks its schedule before unlinking operations, so the reverse order can
  -- deadlock during an edit. KEY SHARE still permits ordinary interval edits.
  for schedule_id in
    select distinct nullif(value ->> 'maintenance_item_id', '')::uuid
    from jsonb_array_elements(p_payload -> 'operations')
    where nullif(value ->> 'maintenance_item_id', '') is not null
    order by 1
  loop
    perform 1 from public.vehicle_maintenance_items m
      where m.id = schedule_id and m.vehicle_id = p_vehicle_id for key share;
    if not found then
      raise exception 'A selected maintenance operation is unavailable' using errcode = '42501';
    end if;
  end loop;

  if p_visit_id is null then
    insert into public.service_visits (
      vehicle_id, service_date, mileage, service_type, workshop_name, total_cost, notes
    ) values (
      p_vehicle_id, visit_date, visit_mileage, visit_type, workshop, visit_cost, visit_notes
    ) returning id into saved_visit_id;
  else
    saved_visit_id := p_visit_id;
    update public.service_visits
    set service_date = visit_date, mileage = visit_mileage, service_type = visit_type,
        workshop_name = workshop, total_cost = visit_cost, notes = visit_notes
    where id = saved_visit_id and vehicle_id = p_vehicle_id;
    if not found then
      raise exception 'Service visit is unavailable or access is denied' using errcode = '42501';
    end if;
    delete from public.service_operations where service_visit_id = saved_visit_id;
  end if;

  for operation in select value from jsonb_array_elements(p_payload -> 'operations')
  loop
    operation_label := nullif(btrim(operation ->> 'operation_name'), '');
    schedule_id := nullif(operation ->> 'maintenance_item_id', '')::uuid;
    operation_cost := nullif(operation ->> 'cost', '')::numeric;
    interval_km := nullif(operation ->> 'next_interval_km', '')::integer;
    interval_months := nullif(operation ->> 'next_interval_months', '')::integer;

    if operation_label is null or char_length(operation_label) > 120 then
      raise exception 'Operation name must contain 1 to 120 characters' using errcode = '23514';
    end if;
    if interval_km is not null and interval_km not between 1 and 10000000 then
      raise exception 'Kilometre override is outside the supported range' using errcode = '23514';
    end if;
    if interval_months is not null and interval_months not between 1 and 1200 then
      raise exception 'Month override is outside the supported range' using errcode = '23514';
    end if;
    if operation_cost is not null
      and (operation_cost < 0 or operation_cost > 999999999.99 or operation_cost <> trunc(operation_cost, 2)) then
      raise exception 'Operation cost is outside the supported precision/range' using errcode = '23514';
    end if;
    insert into public.service_operations (
      service_visit_id, maintenance_item_id, operation_name, cost,
      next_interval_km, next_interval_months
    ) values (
      saved_visit_id, schedule_id, operation_label, operation_cost,
      interval_km, interval_months
    );
  end loop;

  return saved_visit_id;
end;
$$;
revoke all on function public.save_service_visit(uuid, uuid, jsonb) from public, anon;
grant execute on function public.save_service_visit(uuid, uuid, jsonb) to authenticated;

create function public.delete_service_visit(p_vehicle_id uuid, p_visit_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  current_owner_id uuid;
begin
  current_owner_id := public.current_app_owner();
  if current_owner_id is null then
    raise exception 'An authenticated owner is required' using errcode = '42501';
  end if;

  perform 1 from public.vehicles v
    where v.id = p_vehicle_id and v.owner_id = current_owner_id
    for update;
  if not found then
    raise exception 'Vehicle is unavailable or access is denied' using errcode = '42501';
  end if;

  delete from public.service_visits
    where id = p_visit_id and vehicle_id = p_vehicle_id;
  if not found then
    raise exception 'Service visit is unavailable or access is denied' using errcode = '42501';
  end if;

end;
$$;
revoke all on function public.delete_service_visit(uuid, uuid) from public, anon;
grant execute on function public.delete_service_visit(uuid, uuid) to authenticated;

commit;
