-- Run against the linked project after applying the vehicle migration.
-- All fictional users and vehicles are rolled back, including on assertion failure.
begin;

do $$
begin
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'vehicles'
      and c.relrowsecurity and c.relforcerowsecurity
  ) then raise exception 'Vehicles table or enforced RLS is missing'; end if;
  if (select count(*) from pg_policies where schemaname = 'public'
      and tablename = 'vehicles' and policyname in (
        'vehicles_select_owner', 'vehicles_insert_owner',
        'vehicles_update_owner', 'vehicles_delete_owner'
      )) <> 4 then raise exception 'Required policies are missing'; end if;
  if exists (select 1 from auth.users where id in (
    '00000000-0000-4000-8000-00000000a001',
    '00000000-0000-4000-8000-00000000b001'
  )) then raise exception 'Fictional fixture IDs already exist; aborting safely'; end if;
end;
$$;

insert into auth.users (id, aud, role, email) values
  ('00000000-0000-4000-8000-00000000a001', 'authenticated', 'authenticated', 'rls-a@example.invalid'),
  ('00000000-0000-4000-8000-00000000b001', 'authenticated', 'authenticated', 'rls-b@example.invalid');

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000a001';
insert into public.vehicles (id, type, make, model, year, engine, mileage) values
  ('00000000-0000-4000-8000-00000000a002', 'car', 'Fictional Motors', 'RLS Example A', 2020, 'Example', 0);

do $$
declare affected integer;
begin
  if (select count(*) from public.vehicles where id = '00000000-0000-4000-8000-00000000a002') <> 1
    then raise exception 'Owner cannot read own vehicle'; end if;
  update public.vehicles set mileage = 123 where id = '00000000-0000-4000-8000-00000000a002';
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Owner update failed'; end if;
  begin
    update public.vehicles set owner_id = '00000000-0000-4000-8000-00000000b001'
      where id = '00000000-0000-4000-8000-00000000a002';
    raise exception 'Ownership transfer unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.vehicles (type, make, model, year, engine, mileage)
      values ('car', 'Fictional', 'Invalid', 2020, 'Example', -1);
    raise exception 'Invalid mileage unexpectedly accepted';
  exception when check_violation then null;
  end;
end;
$$;

set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000b001';
insert into public.vehicles (id, type, make, model, year, engine, mileage) values
  ('00000000-0000-4000-8000-00000000b002', 'motorcycle', 'Fictional Motors', 'RLS Example B', 2020, 'Example', 0);

do $$
declare affected integer;
begin
  if exists (select 1 from public.vehicles where id = '00000000-0000-4000-8000-00000000a002')
    then raise exception 'Cross-owner read succeeded'; end if;
  if (select count(*) from public.vehicles where id = '00000000-0000-4000-8000-00000000b002') <> 1
    then raise exception 'Second owner cannot read own vehicle'; end if;
  update public.vehicles set mileage = 999 where id = '00000000-0000-4000-8000-00000000a002';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Cross-owner update succeeded'; end if;
  delete from public.vehicles where id = '00000000-0000-4000-8000-00000000a002';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Cross-owner deletion succeeded'; end if;
  begin
    insert into public.vehicles (owner_id, type, make, model, year, engine, mileage)
      values ('00000000-0000-4000-8000-00000000a001', 'car', 'Fictional', 'Forbidden', 2020, 'Example', 0);
    raise exception 'Cross-owner insert succeeded';
  exception when insufficient_privilege then null;
  end;
  delete from public.vehicles where id = '00000000-0000-4000-8000-00000000b002';
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Owner deletion failed'; end if;
end;
$$;

set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000a001';
do $$
begin
  if (select mileage from public.vehicles where id = '00000000-0000-4000-8000-00000000a002') <> 123
    then raise exception 'Cross-owner operation changed the original vehicle'; end if;
end;
$$;

set local role anon;
set local request.jwt.claim.sub = '';
do $$
begin
  begin
    perform id from public.vehicles limit 0;
    raise exception 'Anonymous table access unexpectedly allowed';
  exception when insufficient_privilege then null;
  end;
end;
$$;

rollback;

select 'PASS: schema, forced RLS, owner CRUD, cross-owner denials, ownership protection, mileage constraint, anonymous denial; fixtures rolled back' as result;
