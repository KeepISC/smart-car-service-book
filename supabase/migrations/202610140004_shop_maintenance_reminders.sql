begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Private persistence only. All actors, recipients and epochs are server-derived.
create table app_private.shop_maintenance_reminders (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  shop_id uuid not null references app_private.repair_shops(id),
  maintenance_item_id uuid not null references public.vehicle_maintenance_items(id) on delete cascade,
  owner_id uuid not null references app_private.app_users(id),
  ownership_epoch bigint not null,
  sender_id uuid not null references app_private.app_users(id),
  created_at timestamptz not null default clock_timestamp(),
  read_at timestamptz,
  dismissed_at timestamptz
);
create index shop_reminders_owner_idx on app_private.shop_maintenance_reminders(owner_id, created_at desc, id);
create index shop_reminders_rate_idx on app_private.shop_maintenance_reminders(shop_id, vehicle_id, maintenance_item_id, created_at desc);
create index shop_reminders_vehicle_idx on app_private.shop_maintenance_reminders(vehicle_id, created_at desc);
alter table app_private.shop_maintenance_reminders enable row level security;
alter table app_private.shop_maintenance_reminders force row level security;
revoke all on app_private.shop_maintenance_reminders from public, anon, authenticated;

-- Mirrors calculateMaintenance/applyServiceHistory: independent km/date limits,
-- latest completion vs legacy baseline, one-time overrides and month-end clamp.
-- A vehicle row-version boundary is held by the caller before reading facts.
create function app_private.shop_reminder_is_due(p_vehicle_id uuid, p_item_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare item public.vehicle_maintenance_items; completion record; km integer; months integer;
  baseline_date date; baseline_km integer; vehicle_km integer; today date := (clock_timestamp() at time zone 'UTC')::date;
begin
  select m.* into item from public.vehicle_maintenance_items m
    where m.id = p_item_id and m.vehicle_id = p_vehicle_id for share;
  if not found then raise exception 'Maintenance operation is unavailable' using errcode = '42501'; end if;
  if not item.enabled or item.history_status = 'not_applicable' then return false; end if;
  baseline_date := item.last_completed_date; baseline_km := item.last_completed_mileage;
  km := item.interval_km; months := item.interval_months;
  select sv.service_date, sv.mileage, so.next_interval_km, so.next_interval_months into completion
    from public.service_operations so join public.service_visits sv on sv.id = so.service_visit_id
    where sv.vehicle_id = p_vehicle_id and so.maintenance_item_id = p_item_id
    order by sv.service_date desc, sv.mileage desc, sv.created_at desc, so.created_at desc, so.id desc limit 1;
  if found and (case when baseline_date is not null then
      completion.service_date > baseline_date or (completion.service_date = baseline_date and (baseline_km is null or completion.mileage >= baseline_km))
    else baseline_km is null or completion.mileage >= baseline_km end) then
    baseline_date := completion.service_date; baseline_km := completion.mileage;
    km := coalesce(completion.next_interval_km, km); months := coalesce(completion.next_interval_months, months);
  elsif item.history_status <> 'known' then return false;
  end if;
  select v.mileage into vehicle_km from public.vehicles v where v.id = p_vehicle_id;
  return coalesce(km + baseline_km - vehicle_km <= 1000, false)
    or coalesce((baseline_date + make_interval(months => months))::date <= today + 30, false);
end;
$$;

create function public.send_shop_maintenance_reminder(p_shop_id uuid, p_vehicle_id uuid, p_maintenance_item_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare vehicle public.vehicles; reminder_id uuid; sent_at timestamptz;
begin
  -- Vehicle -> exclusive shop -> schedule -> reminder. Row updates serialize
  -- rate limits and reject stale stronger-isolation snapshots, even across vehicles.
  update public.vehicles v set mileage = v.mileage where v.id = p_vehicle_id returning v.* into vehicle;
  if not found then raise exception 'Vehicle is unavailable' using errcode = '42501'; end if;
  perform app_private.lock_repair_shop(p_shop_id, false, true);
  perform app_private.lock_shop_vehicle(p_shop_id, p_vehicle_id, false);
  if not app_private.shop_reminder_is_due(p_vehicle_id, p_maintenance_item_id) then
    raise exception 'Maintenance is not overdue or due soon' using errcode = '23514';
  end if;
  sent_at := clock_timestamp();
  if exists (select 1 from app_private.shop_maintenance_reminders r where r.shop_id = p_shop_id
      and r.vehicle_id = p_vehicle_id and r.maintenance_item_id = p_maintenance_item_id
      and r.created_at > sent_at - interval '7 days')
    or (select count(*) from app_private.shop_maintenance_reminders r where r.vehicle_id = p_vehicle_id
      and r.created_at > sent_at - interval '24 hours') >= 3
    or (select count(*) from app_private.shop_maintenance_reminders r where r.shop_id = p_shop_id
      and r.created_at > sent_at - interval '24 hours') >= 50 then
    raise exception 'Reminder rate limit reached; try again later' using errcode = 'P0001';
  end if;
  -- Check wall-clock entitlement again after any schedule-lock wait.
  perform app_private.require_shop_access(p_shop_id, false);
  insert into app_private.shop_maintenance_reminders(vehicle_id, shop_id, maintenance_item_id, owner_id, ownership_epoch, sender_id, created_at)
    values (p_vehicle_id, p_shop_id, p_maintenance_item_id, vehicle.owner_id, vehicle.ownership_epoch, app_private.repair_shop_actor(), sent_at)
    returning id into reminder_id;
  return reminder_id;
end;
$$;

create function public.list_shop_maintenance_reminders() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid := app_private.repair_shop_actor();
begin
  -- Transfer either waits for this read or changes the version before we read.
  perform 1 from public.vehicles v where v.owner_id = actor order by v.id for share;
  return (select coalesce(jsonb_agg(to_jsonb(result) order by result.created_at desc, result.id), '[]'::jsonb) from (
    select r.id, r.vehicle_id, r.shop_id, s.name shop_name, r.maintenance_item_id,
      m.name operation_name, concat_ws(' ', v.year, v.make, v.model) vehicle_name, r.created_at, r.read_at
    from app_private.shop_maintenance_reminders r join public.vehicles v on v.id = r.vehicle_id
      join app_private.repair_shops s on s.id = r.shop_id
      join public.vehicle_maintenance_items m on m.id = r.maintenance_item_id and m.vehicle_id = v.id
    where r.owner_id = actor and v.owner_id = actor and r.ownership_epoch = v.ownership_epoch and r.dismissed_at is null
    order by r.created_at desc, r.id limit 100
  ) result);
end;
$$;

create function public.set_shop_maintenance_reminder_state(p_reminder_id uuid, p_state text) returns void
language plpgsql security definer set search_path = '' as $$
declare actor uuid := app_private.repair_shop_actor(); vehicle public.vehicles; vehicle_id uuid;
begin
  if p_state is null or p_state not in ('read', 'dismissed') then raise exception 'Invalid reminder state' using errcode = '22023'; end if;
  select r.vehicle_id into vehicle_id from app_private.shop_maintenance_reminders r where r.id = p_reminder_id and r.owner_id = actor;
  select v.* into vehicle from public.vehicles v where v.id = vehicle_id and v.owner_id = actor for share;
  if not found then raise exception 'Reminder is unavailable' using errcode = '42501'; end if;
  update app_private.shop_maintenance_reminders r set read_at = coalesce(r.read_at, clock_timestamp()),
    dismissed_at = case when p_state = 'dismissed' then coalesce(r.dismissed_at, clock_timestamp()) else r.dismissed_at end
    where r.id = p_reminder_id and r.owner_id = actor and r.ownership_epoch = vehicle.ownership_epoch;
  if not found then raise exception 'Reminder is unavailable' using errcode = '42501'; end if;
end;
$$;

revoke all on function app_private.shop_reminder_is_due(uuid, uuid) from public, anon, authenticated;
revoke all on function public.send_shop_maintenance_reminder(uuid, uuid, uuid), public.list_shop_maintenance_reminders(),
  public.set_shop_maintenance_reminder_state(uuid, text) from public, anon, authenticated;
grant execute on function public.send_shop_maintenance_reminder(uuid, uuid, uuid), public.list_shop_maintenance_reminders(),
  public.set_shop_maintenance_reminder_state(uuid, text) to authenticated;
notify pgrst, 'reload schema';
commit;
