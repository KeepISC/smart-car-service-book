begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.vehicles in share row exclusive mode;

-- No invented baseline: existing mileage and maintenance records stay untouched.
create table public.vehicle_mileage_history (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  recorded_at timestamptz not null default clock_timestamp(),
  mileage integer not null check (mileage between 0 and 10000000),
  source text not null check (source = 'manual')
);
create index vehicle_mileage_history_vehicle_recorded_idx
  on public.vehicle_mileage_history(vehicle_id, recorded_at desc, id desc);
alter table public.vehicle_mileage_history enable row level security;
alter table public.vehicle_mileage_history force row level security;
revoke all on public.vehicle_mileage_history from public, anon, authenticated;
grant select on public.vehicle_mileage_history to authenticated;
create policy vehicle_mileage_history_owner_select on public.vehicle_mileage_history
  for select to authenticated using (
    exists (
      select 1 from public.vehicles v
      where v.id = vehicle_id and v.owner_id = (select public.current_app_owner())
    )
  );

-- Trigger-only privilege permits append-only history without client write grants.
-- The parent update already passed vehicle RLS and consistency checks and holds
-- its row lock. Failure to append rolls back the vehicle update as well.
create function public.record_vehicle_mileage() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.vehicle_mileage_history(vehicle_id, mileage, source)
    values (new.id, new.mileage, 'manual');
  return new;
end;
$$;
revoke all on function public.record_vehicle_mileage() from public, anon, authenticated;
create trigger vehicle_mileage_history_append after update of mileage on public.vehicles
  for each row when (old.mileage is distinct from new.mileage)
  execute function public.record_vehicle_mileage();

-- Invoker RLS resolves the owner; callers cannot supply an owner or history data.
create function public.update_vehicle_mileage(p_vehicle_id uuid, p_mileage integer)
returns public.vehicles language plpgsql set search_path = '' as $$
declare current_vehicle public.vehicles;
begin
  if p_mileage is null or p_mileage not between 0 and 10000000 then
    raise exception 'Enter a whole number between 0 and 10,000,000.' using errcode = '22023';
  end if;
  -- Serialize with manual edits, maintenance and Service History on the parent.
  -- A stale stronger-isolation snapshot fails with 40001 rather than overwriting.
  select v.* into current_vehicle from public.vehicles v
    where v.id = p_vehicle_id for update;
  if not found then
    raise exception 'Vehicle is unavailable or access is denied' using errcode = '42501';
  end if;
  if p_mileage < current_vehicle.mileage then
    raise exception 'Mileage cannot be decreased below the existing recorded mileage.' using errcode = '23514';
  end if;
  if p_mileage = current_vehicle.mileage then return current_vehicle; end if;
  update public.vehicles set mileage = p_mileage where id = p_vehicle_id
    returning * into current_vehicle;
  return current_vehicle;
end;
$$;
revoke all on function public.update_vehicle_mileage(uuid, integer) from public, anon;
grant execute on function public.update_vehicle_mileage(uuid, integer) to authenticated;

commit;
