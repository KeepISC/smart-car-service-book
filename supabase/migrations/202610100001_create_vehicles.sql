begin;
create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  type text not null check (type in ('car', 'motorcycle')),
  make text not null check (char_length(btrim(make)) between 1 and 100),
  model text not null check (char_length(btrim(model)) between 1 and 100),
  year integer not null check (year between 1886 and extract(year from current_date)::integer + 1),
  engine text not null check (char_length(btrim(engine)) between 1 and 100),
  mileage integer not null default 0 check (mileage between 0 and 10000000),
  license_plate text check (license_plate is null or char_length(btrim(license_plate)) between 1 and 20),
  vin text check (vin is null or vin ~ '^[A-HJ-NPR-Z0-9]{17}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index vehicles_owner_created_idx on public.vehicles(owner_id, created_at desc);
alter table public.vehicles enable row level security;
alter table public.vehicles force row level security;
revoke all on public.vehicles from anon, authenticated;
grant select, insert, delete on public.vehicles to authenticated;
grant update(type, make, model, year, engine, mileage, license_plate, vin) on public.vehicles to authenticated;
create policy vehicles_select_owner on public.vehicles for select to authenticated using ((select auth.uid()) = owner_id);
create policy vehicles_insert_owner on public.vehicles for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy vehicles_update_owner on public.vehicles for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy vehicles_delete_owner on public.vehicles for delete to authenticated using ((select auth.uid()) = owner_id);
create function public.set_vehicle_updated_at() returns trigger language plpgsql set search_path = '' as $$ begin new.updated_at = now(); return new; end; $$;
create trigger vehicles_updated_at before update on public.vehicles for each row execute function public.set_vehicle_updated_at();
commit;
