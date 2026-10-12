begin;

-- Freeze writers during installation; never rewrite or delete historical records.
lock table public.vehicles, public.vehicle_maintenance_items in share row exclusive mode;
do $$
begin
  if exists (
    select 1 from public.vehicle_maintenance_items m
    join public.vehicles v on v.id = m.vehicle_id
    where m.last_completed_mileage > v.mileage
  ) then
    raise exception 'Existing maintenance mileage exceeds current vehicle mileage'
      using errcode = '23514',
        hint = 'Review inconsistent records privately before applying this migration; no data has been changed.';
  end if;
end;
$$;

create function public.validate_vehicle_mileage() returns trigger
language plpgsql set search_path = '' as $$
begin
  if exists (
    select 1 from public.vehicle_maintenance_items m
    where m.vehicle_id = new.id and m.last_completed_mileage > new.mileage
  ) then
    raise exception 'Vehicle mileage is below a recorded maintenance completion'
      using errcode = '23514', constraint = 'vehicle_maintenance_mileage_consistency';
  end if;
  return new;
end;
$$;
revoke all on function public.validate_vehicle_mileage() from public, anon, authenticated;
create trigger vehicle_mileage_check before update of mileage on public.vehicles
  for each row when (old.mileage is distinct from new.mileage)
  execute function public.validate_vehicle_mileage();

create or replace function public.validate_maintenance_completion() returns trigger
language plpgsql set search_path = '' as $$
declare current_mileage integer;
begin
  -- Both writers serialize on the parent. A real row version (not only FOR UPDATE)
  -- also makes stale REPEATABLE READ/SERIALIZABLE writers fail with 40001.
  -- Invoker permissions/RLS still apply; no privileged ownership bypass is added.
  update public.vehicles set mileage = mileage where id = new.vehicle_id
    returning mileage into current_mileage;
  if not found then
    raise exception 'Vehicle is unavailable or access is denied' using errcode = '42501';
  end if;
  if new.last_completed_mileage > current_mileage then
    raise exception 'Maintenance completion exceeds current vehicle mileage'
      using errcode = '23514', constraint = 'vehicle_maintenance_mileage_consistency';
  end if;
  return new;
end;
$$;
revoke all on function public.validate_maintenance_completion() from public, anon, authenticated;

commit;
