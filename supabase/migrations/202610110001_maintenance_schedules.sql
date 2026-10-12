begin;

-- Catalog writes are reserved for trusted administrators; no examples are seeded here.
create table public.maintenance_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  vehicle_type text not null check (vehicle_type in ('car', 'motorcycle')),
  make text not null check (char_length(btrim(make)) between 1 and 100),
  model text not null check (char_length(btrim(model)) between 1 and 100),
  year_from integer not null check (year_from between 1886 and 3000),
  year_to integer not null check (year_to between year_from and 3000),
  engine text not null check (char_length(btrim(engine)) between 1 and 100),
  source_name text not null check (char_length(btrim(source_name)) between 1 and 200),
  source_url text not null check (source_url ~ '^https://[^[:space:]]+$' and char_length(source_url) <= 2000),
  source_notes text check (char_length(source_notes) <= 4000),
  verified boolean not null default false,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  check (not verified or verified_at is not null)
);
create index maintenance_template_match_idx on public.maintenance_templates (vehicle_type, lower(make), lower(model), lower(engine), year_from, year_to) where verified;

create table public.maintenance_template_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.maintenance_templates(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  interval_km integer check (interval_km between 1 and 10000000),
  interval_months integer check (interval_months between 1 and 1200),
  check (interval_km is not null or interval_months is not null)
);
create index maintenance_template_items_template_idx on public.maintenance_template_items(template_id);

create table public.vehicle_maintenance_items (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  interval_km integer check (interval_km between 1 and 10000000),
  interval_months integer check (interval_months between 1 and 1200),
  enabled boolean not null default true,
  history_status text not null default 'unknown' check (history_status in ('known', 'unknown', 'not_applicable')),
  last_completed_date date check (last_completed_date <= current_date),
  last_completed_mileage integer check (last_completed_mileage between 0 and 10000000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (interval_km is not null or interval_months is not null),
  check ((history_status = 'known' and (last_completed_date is not null or last_completed_mileage is not null))
    or (history_status in ('unknown', 'not_applicable') and last_completed_date is null and last_completed_mileage is null))
);
create index vehicle_maintenance_items_vehicle_idx on public.vehicle_maintenance_items(vehicle_id, created_at);

alter table public.maintenance_templates enable row level security;
alter table public.maintenance_templates force row level security;
alter table public.maintenance_template_items enable row level security;
alter table public.maintenance_template_items force row level security;
alter table public.vehicle_maintenance_items enable row level security;
alter table public.vehicle_maintenance_items force row level security;
revoke all on public.maintenance_templates, public.maintenance_template_items, public.vehicle_maintenance_items from anon, authenticated;
grant select on public.maintenance_templates, public.maintenance_template_items to authenticated;
grant select, insert, delete on public.vehicle_maintenance_items to authenticated;
grant update(name, interval_km, interval_months, enabled, history_status, last_completed_date, last_completed_mileage) on public.vehicle_maintenance_items to authenticated;
create policy templates_verified_read on public.maintenance_templates for select to authenticated using (verified);
create policy template_items_verified_read on public.maintenance_template_items for select to authenticated using (
  exists (select 1 from public.maintenance_templates t where t.id = template_id and t.verified)
);
create policy maintenance_owner_select on public.vehicle_maintenance_items for select to authenticated using (
  exists (select 1 from public.vehicles v where v.id = vehicle_id and v.owner_id = (select auth.uid()))
);
create policy maintenance_owner_insert on public.vehicle_maintenance_items for insert to authenticated with check (
  exists (select 1 from public.vehicles v where v.id = vehicle_id and v.owner_id = (select auth.uid()))
);
create policy maintenance_owner_update on public.vehicle_maintenance_items for update to authenticated using (
  exists (select 1 from public.vehicles v where v.id = vehicle_id and v.owner_id = (select auth.uid()))
) with check (
  exists (select 1 from public.vehicles v where v.id = vehicle_id and v.owner_id = (select auth.uid()))
);
create policy maintenance_owner_delete on public.vehicle_maintenance_items for delete to authenticated using (
  exists (select 1 from public.vehicles v where v.id = vehicle_id and v.owner_id = (select auth.uid()))
);

create function public.validate_maintenance_completion() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.last_completed_mileage > (select mileage from public.vehicles where id = new.vehicle_id) then
    raise exception 'Completion mileage exceeds current vehicle mileage' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger maintenance_completion_check before insert or update on public.vehicle_maintenance_items
  for each row execute function public.validate_maintenance_completion();
create trigger maintenance_updated_at before update on public.vehicle_maintenance_items
  for each row execute function public.set_vehicle_updated_at();
commit;
