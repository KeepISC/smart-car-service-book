-- Run only on a test database after the maintenance migration is approved/applied.
-- Fixtures are fictional and all writes are rolled back.
begin;
do $$
begin
  if exists (select 1 from auth.users where id in (
    '00000000-0000-4000-8000-00000000c001', '00000000-0000-4000-8000-00000000d001'
  )) then raise exception 'Fixture IDs exist; aborting safely'; end if;
  if (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in ('maintenance_templates', 'maintenance_template_items', 'vehicle_maintenance_items')
    and c.relrowsecurity and c.relforcerowsecurity) <> 3 then raise exception 'RLS must be enforced on all maintenance tables'; end if;
end;
$$;
insert into auth.users (id, aud, role, email) values
  ('00000000-0000-4000-8000-00000000c001', 'authenticated', 'authenticated', 'maintenance-c@example.invalid'),
  ('00000000-0000-4000-8000-00000000d001', 'authenticated', 'authenticated', 'maintenance-d@example.invalid');
insert into public.vehicles (id, owner_id, type, make, model, year, engine, mileage) values
  ('00000000-0000-4000-8000-00000000c002', '00000000-0000-4000-8000-00000000c001', 'car', 'Fictional Motors', 'Example C', 2020, 'Example', 10000),
  ('00000000-0000-4000-8000-00000000d002', '00000000-0000-4000-8000-00000000d001', 'car', 'Fictional Motors', 'Example D', 2020, 'Example', 10000);
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000c001';
insert into public.vehicle_maintenance_items (id, vehicle_id, name, interval_km) values
  ('00000000-0000-4000-8000-00000000c003', '00000000-0000-4000-8000-00000000c002', 'Fictional operation', 1000);
do $$
declare affected integer;
begin
  if (select count(*) from public.vehicle_maintenance_items where id = '00000000-0000-4000-8000-00000000c003') <> 1
    then raise exception 'Owner read failed'; end if;
  update public.vehicle_maintenance_items set interval_km = 2000 where id = '00000000-0000-4000-8000-00000000c003';
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Owner interval edit failed'; end if;
  begin
    update public.vehicle_maintenance_items set vehicle_id = '00000000-0000-4000-8000-00000000d002'
      where id = '00000000-0000-4000-8000-00000000c003';
    raise exception 'Vehicle reassignment succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.vehicle_maintenance_items set history_status = 'known', last_completed_mileage = 10001
      where id = '00000000-0000-4000-8000-00000000c003';
    raise exception 'Future completion mileage succeeded';
  exception when check_violation then null;
  end;
  begin
    insert into public.maintenance_templates (name, vehicle_type, make, model, year_from, year_to, engine, source_name, source_url)
      values ('Forbidden', 'car', 'Fictional', 'Example', 2020, 2020, 'Example', 'Fictional source', 'https://example.invalid');
    raise exception 'Regular user catalog insert succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.maintenance_templates set verified = true;
    raise exception 'Regular user catalog update succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.maintenance_templates where id = '00000000-0000-4000-8000-00000000c004';
    raise exception 'Regular user catalog delete succeeded';
  exception when insufficient_privilege then null;
  end;
end;
$$;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000d001';
do $$
declare affected integer;
begin
  if exists (select 1 from public.vehicle_maintenance_items where id = '00000000-0000-4000-8000-00000000c003')
    then raise exception 'Cross-owner read succeeded'; end if;
  update public.vehicle_maintenance_items set enabled = false where id = '00000000-0000-4000-8000-00000000c003';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Cross-owner update succeeded'; end if;
  delete from public.vehicle_maintenance_items where id = '00000000-0000-4000-8000-00000000c003';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Cross-owner delete succeeded'; end if;
  begin
    insert into public.vehicle_maintenance_items (vehicle_id, name, interval_months)
      values ('00000000-0000-4000-8000-00000000c002', 'Forbidden', 12);
    raise exception 'Cross-owner insert succeeded';
  exception when insufficient_privilege then null;
  end;
end;
$$;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000c001';
do $$
declare affected integer;
begin
  delete from public.vehicle_maintenance_items where id = '00000000-0000-4000-8000-00000000c003';
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Owner deletion failed'; end if;
end;
$$;
set local role anon;
set local request.jwt.claim.sub = '';
do $$
begin
  begin
    perform id from public.vehicle_maintenance_items limit 0;
    raise exception 'Anonymous access succeeded';
  exception when insufficient_privilege then null;
  end;
end;
$$;
rollback;
select 'PASS: maintenance owner isolation, protected catalog, validation and fixture rollback' as result;
