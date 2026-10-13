-- Disposable database only. Fictional owners/vehicles and all writes roll back.
begin;
do $$
begin
  if exists (select 1 from app_private.app_users where id in (
    '00000000-0000-4000-8000-00000000c301',
    '00000000-0000-4000-8000-00000000d301'
  )) then raise exception 'Fixture IDs exist; aborting safely'; end if;
  if (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('service_visits', 'service_operations')
      and c.relrowsecurity and c.relforcerowsecurity) <> 2
  then raise exception 'RLS must be enabled and forced for service history'; end if;
  if has_table_privilege('authenticated', 'public.service_visits', 'INSERT')
    or has_table_privilege('authenticated', 'public.service_operations', 'UPDATE')
    or has_table_privilege('authenticated', 'public.vehicle_maintenance_items', 'UPDATE')
    or has_column_privilege('authenticated', 'public.vehicle_maintenance_items', 'vehicle_id', 'UPDATE')
    or has_column_privilege('authenticated', 'public.vehicle_maintenance_items', 'id', 'UPDATE')
  then raise exception 'Direct service-history writes must remain unavailable'; end if;
  if has_function_privilege('anon', 'public.save_service_visit(uuid,uuid,jsonb)', 'EXECUTE')
    or has_function_privilege('anon', 'public.delete_service_visit(uuid,uuid)', 'EXECUTE')
    or has_function_privilege('scsb_provisioner', 'public.save_service_visit(uuid,uuid,jsonb)', 'EXECUTE')
    or has_table_privilege('authenticated', 'public.service_visits', 'UPDATE')
    or has_table_privilege('authenticated', 'public.service_visits', 'DELETE')
    or has_table_privilege('authenticated', 'public.service_operations', 'INSERT')
    or has_table_privilege('authenticated', 'public.service_operations', 'DELETE')
  then raise exception 'Service-history privileges exceed the intended boundary'; end if;
end;
$$;

update app_private.firebase_config set project_id = 'fictional-service-history';
insert into app_private.app_users(id) values
  ('00000000-0000-4000-8000-00000000c301'),
  ('00000000-0000-4000-8000-00000000d301');
insert into app_private.firebase_identities(firebase_uid, owner_id) values
  ('fictional-service-owner-c', '00000000-0000-4000-8000-00000000c301'),
  ('fictional-service-owner-d', '00000000-0000-4000-8000-00000000d301');
insert into app_private.firebase_provisioning_approvals(firebase_uid) values
  ('fictional-service-owner-c'), ('fictional-service-owner-d');
insert into public.vehicles(id, owner_id, type, make, model, year, engine, mileage) values
  ('00000000-0000-4000-8000-00000000c302', '00000000-0000-4000-8000-00000000c301', 'car', 'Fictional Motors', 'Service C', 2020, 'Example', 50000),
  ('00000000-0000-4000-8000-00000000d302', '00000000-0000-4000-8000-00000000d301', 'car', 'Fictional Motors', 'Service D', 2020, 'Example', 50000);
insert into public.vehicle_maintenance_items(
  id, vehicle_id, name, interval_km, interval_months, history_status,
  last_completed_date, last_completed_mileage
) values
  ('00000000-0000-4000-8000-00000000c303', '00000000-0000-4000-8000-00000000c302',
   'Fictional scheduled operation', 10000, 12, 'known',
   current_date - 20, 20000),
  ('00000000-0000-4000-8000-00000000d303', '00000000-0000-4000-8000-00000000d302',
   'Fictional private operation', 5000, 6, 'unknown', null, null),
  ('00000000-0000-4000-8000-00000000c304', '00000000-0000-4000-8000-00000000c302',
   'Fictional not-applicable operation', 5000, 6, 'not_applicable', null, null),
  ('00000000-0000-4000-8000-00000000c306', '00000000-0000-4000-8000-00000000c302',
   'Fictional mileage-only legacy operation', 10000, 12, 'known', null, 35000);

set local request.jwt.claims = '{"iss":"https://securetoken.google.com/fictional-service-history","aud":"fictional-service-history","sub":"fictional-service-owner-c","role":"authenticated","email_verified":true,"app_owner_id":"00000000-0000-4000-8000-00000000c301"}';
set local role authenticated;
do $$
declare
  visit_id uuid;
  older_visit_id uuid;
  not_applicable_visit_id uuid;
  mileage_only_visit_id uuid;
  schedule_to_delete_id uuid;
  expected_date date := current_date - 5;
begin
  mileage_only_visit_id := public.save_service_visit(
    '00000000-0000-4000-8000-00000000c302', null,
    jsonb_build_object(
      'service_date', (current_date - 1)::text, 'mileage', 25000,
      'service_type', 'diy', 'workshop_name', null, 'operations',
      jsonb_build_array(jsonb_build_object(
        'maintenance_item_id', '00000000-0000-4000-8000-00000000c306',
        'operation_name', 'Fictional older mileage-only completion',
        'next_interval_km', null, 'next_interval_months', null
      ))
    )
  );
  if (select last_completed_date from public.vehicle_maintenance_items
      where id = '00000000-0000-4000-8000-00000000c306') is not null
    or (select last_completed_mileage from public.vehicle_maintenance_items
      where id = '00000000-0000-4000-8000-00000000c306') <> 35000
    then raise exception 'Older history replaced a mileage-only legacy baseline'; end if;
  perform public.delete_service_visit(
    '00000000-0000-4000-8000-00000000c302', mileage_only_visit_id
  );

  not_applicable_visit_id := public.save_service_visit(
    '00000000-0000-4000-8000-00000000c302', null,
    jsonb_build_object(
      'service_date', (current_date - 2)::text, 'mileage', 28000,
      'service_type', 'diy', 'workshop_name', null, 'operations',
      jsonb_build_array(jsonb_build_object(
        'maintenance_item_id', '00000000-0000-4000-8000-00000000c304',
        'operation_name', 'Fictional completed not-applicable operation',
        'next_interval_km', null, 'next_interval_months', null
      ))
    )
  );
  if (select history_status from public.vehicle_maintenance_items
      where id = '00000000-0000-4000-8000-00000000c304') <> 'not_applicable'
    then raise exception 'Service history mutated the existing maintenance baseline'; end if;
  perform public.delete_service_visit(
    '00000000-0000-4000-8000-00000000c302', not_applicable_visit_id
  );
  if (select history_status from public.vehicle_maintenance_items
      where id = '00000000-0000-4000-8000-00000000c304') <> 'not_applicable'
    then raise exception 'Deleting the visit did not restore not-applicable status'; end if;

  visit_id := public.save_service_visit(
    '00000000-0000-4000-8000-00000000c302', null,
    jsonb_build_object(
      'service_date', expected_date::text,
      'mileage', 30000,
      'service_type', 'workshop',
      'workshop_name', 'Fictional workshop',
      'total_cost', 125.50,
      'notes', 'Fictional service history test',
      'operations', jsonb_build_array(
        jsonb_build_object(
          'maintenance_item_id', '00000000-0000-4000-8000-00000000c303',
          'operation_name', 'Fictional scheduled operation',
          'cost', null,
          'next_interval_km', 12000,
          'next_interval_months', null
        ),
        jsonb_build_object(
          'maintenance_item_id', null,
          'operation_name', 'Fictional custom operation',
          'cost', 12.25,
          'next_interval_km', null,
          'next_interval_months', null
        )
      )
    )
  );
  if (select count(*) from public.service_operations where service_visit_id = visit_id) <> 2
    then raise exception 'Multiple scheduled/custom operations were not saved'; end if;
  if (select total_cost from public.service_visits where id = visit_id) <> 125.50
    or (select cost from public.service_operations where service_visit_id = visit_id
        and maintenance_item_id is null) <> 12.25
    then raise exception 'Optional/partial cost values were not retained'; end if;
  if (select last_completed_date from public.vehicle_maintenance_items
      where id = '00000000-0000-4000-8000-00000000c303') <> current_date - 20
    then raise exception 'Service history mutated the stored maintenance baseline'; end if;
  if (select interval_km from public.vehicle_maintenance_items
      where id = '00000000-0000-4000-8000-00000000c303') <> 10000
    or (select interval_months from public.vehicle_maintenance_items
      where id = '00000000-0000-4000-8000-00000000c303') <> 12
    or (select next_interval_km from public.service_operations
      where service_visit_id = visit_id and maintenance_item_id = '00000000-0000-4000-8000-00000000c303') <> 12000
    then raise exception 'Overrides changed permanent defaults or were not retained'; end if;

  older_visit_id := public.save_service_visit(
    '00000000-0000-4000-8000-00000000c302', null,
    jsonb_build_object(
      'service_date', (current_date - 15)::text, 'mileage', 19000,
      'service_type', 'diy', 'workshop_name', null, 'total_cost', null,
      'notes', null, 'operations', jsonb_build_array(jsonb_build_object(
        'maintenance_item_id', '00000000-0000-4000-8000-00000000c303',
        'operation_name', 'Fictional backdated completion', 'cost', null,
        'next_interval_km', null, 'next_interval_months', null
      ))
    )
  );
  if (select last_completed_date from public.vehicle_maintenance_items
      where id = '00000000-0000-4000-8000-00000000c303') <> current_date - 20
    then raise exception 'Backdated history replaced a newer completion'; end if;

  perform public.save_service_visit(
    '00000000-0000-4000-8000-00000000c302', older_visit_id,
    jsonb_build_object(
      'service_date', (current_date - 3)::text, 'mileage', 25000,
      'service_type', 'diy', 'workshop_name', null, 'total_cost', null,
      'notes', 'Fictional edited historical visit',
      'operations', jsonb_build_array(jsonb_build_object(
        'maintenance_item_id', '00000000-0000-4000-8000-00000000c303',
        'operation_name', 'Fictional edited operation', 'cost', null,
        'next_interval_km', null, 'next_interval_months', 24
      ))
    )
  );
  if (select last_completed_date from public.vehicle_maintenance_items
      where id = '00000000-0000-4000-8000-00000000c303') <> current_date - 20
    then raise exception 'Visit edit mutated the stored maintenance baseline'; end if;

  begin
    perform public.save_service_visit(
      '00000000-0000-4000-8000-00000000c302', visit_id,
      jsonb_build_object(
        'service_date', (current_date - 1)::text, 'mileage', 40000,
        'service_type', 'diy', 'workshop_name', null, 'total_cost', null,
        'notes', null, 'operations', jsonb_build_array(
          jsonb_build_object(
            'maintenance_item_id', '00000000-0000-4000-8000-00000000c303',
            'operation_name', 'Fictional valid first operation',
            'next_interval_km', null, 'next_interval_months', null
          ),
          jsonb_build_object(
            'maintenance_item_id', null,
            'operation_name', 'Fictional invalid custom operation',
            'next_interval_km', 0, 'next_interval_months', null
          )
        )
      )
    );
    raise exception 'Invalid edit unexpectedly succeeded';
  exception when check_violation then null; end;
  if (select service_date from public.service_visits where id = visit_id) <> expected_date
    or (select count(*) from public.service_operations where service_visit_id = visit_id) <> 2
    then raise exception 'Failed edit partially modified a service visit'; end if;
  if (select last_completed_date from public.vehicle_maintenance_items
      where id = '00000000-0000-4000-8000-00000000c303') <> current_date - 20
    then raise exception 'Failed edit changed the stored maintenance baseline'; end if;

  begin
    perform public.save_service_visit(
      '00000000-0000-4000-8000-00000000c302', null,
      jsonb_build_object(
        'service_date', '-infinity', 'mileage', 30000,
        'service_type', 'diy', 'operations', jsonb_build_array(jsonb_build_object(
          'operation_name', 'Fictional unsupported date'
        ))
      )
    );
    raise exception 'Non-finite date unexpectedly succeeded';
  exception when check_violation then null; end;

  begin
    perform public.save_service_visit(
      '00000000-0000-4000-8000-00000000c302', null,
      jsonb_build_object(
        'service_date', (current_date + 1)::text, 'mileage', 30000,
        'service_type', 'diy', 'workshop_name', null, 'operations',
        jsonb_build_array(jsonb_build_object(
          'maintenance_item_id', null, 'operation_name', 'Fictional future entry',
          'next_interval_km', null, 'next_interval_months', null
        ))
      )
    );
    raise exception 'Future visit unexpectedly succeeded';
  exception when check_violation or datetime_field_overflow then null; end;

  begin
    perform public.save_service_visit(
      '00000000-0000-4000-8000-00000000c302', null,
      jsonb_build_object(
        'service_date', current_date::text, 'mileage', 50001,
        'service_type', 'diy', 'workshop_name', null, 'operations',
        jsonb_build_array(jsonb_build_object(
          'maintenance_item_id', null, 'operation_name', 'Fictional future odometer',
          'next_interval_km', null, 'next_interval_months', null
        ))
      )
    );
    raise exception 'Mileage above vehicle odometer unexpectedly succeeded';
  exception when check_violation then null; end;

  begin
    perform public.save_service_visit(
      '00000000-0000-4000-8000-00000000c302', null,
      jsonb_build_object(
        'service_date', current_date::text, 'mileage', 30000,
        'service_type', 'workshop', 'workshop_name', 'Fictional workshop',
        'operations', jsonb_build_array(jsonb_build_object(
          'maintenance_item_id', '00000000-0000-4000-8000-00000000d303',
          'operation_name', 'Fictional cross-vehicle operation',
          'next_interval_km', null, 'next_interval_months', null
        ))
      )
    );
    raise exception 'Cross-vehicle schedule reference unexpectedly succeeded';
  exception when insufficient_privilege then null; end;

  if (select count(*) from public.service_visits where vehicle_id = '00000000-0000-4000-8000-00000000c302') <> 2
    then raise exception 'Rejected writes left a partial visit'; end if;

  perform public.delete_service_visit('00000000-0000-4000-8000-00000000c302', older_visit_id);
  if (select last_completed_date from public.vehicle_maintenance_items
      where id = '00000000-0000-4000-8000-00000000c303') <> current_date - 20
    then raise exception 'Deletion changed the stored maintenance baseline'; end if;
  perform public.delete_service_visit('00000000-0000-4000-8000-00000000c302', visit_id);
  if (select last_completed_date from public.vehicle_maintenance_items
      where id = '00000000-0000-4000-8000-00000000c303') <> current_date - 20
    or (select last_completed_mileage from public.vehicle_maintenance_items
      where id = '00000000-0000-4000-8000-00000000c303') <> 20000
    then raise exception 'Deleting history changed the stored maintenance baseline'; end if;
  insert into public.vehicle_maintenance_items(
    vehicle_id, name, interval_km, history_status
  ) values (
    '00000000-0000-4000-8000-00000000c302',
    'Fictional schedule removed after service', 10000, 'unknown'
  ) returning id into schedule_to_delete_id;
  visit_id := public.save_service_visit(
    '00000000-0000-4000-8000-00000000c302', null,
    jsonb_build_object(
      'service_date', current_date::text, 'mileage', 45000,
      'service_type', 'diy', 'workshop_name', null, 'operations',
      jsonb_build_array(jsonb_build_object(
        'maintenance_item_id', schedule_to_delete_id,
        'operation_name', 'Fictional preserved operation snapshot',
        'next_interval_km', 15000, 'next_interval_months', null
      ))
    )
  );
  delete from public.vehicle_maintenance_items
    where id = schedule_to_delete_id;
  if (select count(*) from public.service_operations
      where service_visit_id = visit_id
        and maintenance_item_id is null
        and operation_name = 'Fictional preserved operation snapshot'
        and next_interval_km = 15000) <> 1
    then raise exception 'Schedule deletion lost the operation snapshot'; end if;
  begin
    update public.vehicles set mileage = 40000
      where id = '00000000-0000-4000-8000-00000000c302';
    raise exception 'Vehicle mileage below a service visit unexpectedly succeeded';
  exception when check_violation then null; end;
  update public.vehicles set mileage = 45000
    where id = '00000000-0000-4000-8000-00000000c302';

  begin
    perform public.delete_service_visit(
      '00000000-0000-4000-8000-00000000c302',
      '00000000-0000-4000-8000-00000000c399'
    );
    raise exception 'Missing visit deletion unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
end;
$$;

do $$
begin
  -- Legacy payloads may retain unchanged baseline fields during schedule edits.
    update public.vehicle_maintenance_items
      set name = 'Fictional legacy payload', history_status = history_status,
          last_completed_date = last_completed_date,
          last_completed_mileage = last_completed_mileage
      where id = '00000000-0000-4000-8000-00000000c303';
  update public.vehicle_maintenance_items set name = name, interval_km = interval_km
    where id = '00000000-0000-4000-8000-00000000c303';
  begin
    update public.vehicle_maintenance_items
      set last_completed_date = current_date + 1
      where id = '00000000-0000-4000-8000-00000000c303';
    raise exception 'Future legacy completion unexpectedly succeeded';
  exception when check_violation then null; end;
  begin
    insert into public.service_visits(vehicle_id, service_date, mileage, service_type)
      values ('00000000-0000-4000-8000-00000000c302', current_date, 30000, 'diy');
    raise exception 'Direct table insertion unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
end;
$$;

set local request.jwt.claims = '{"iss":"https://securetoken.google.com/fictional-service-history","aud":"fictional-service-history","sub":"fictional-service-owner-d","role":"authenticated","email_verified":true,"app_owner_id":"00000000-0000-4000-8000-00000000d301"}';
do $$
declare affected integer;
begin
  if exists (select 1 from public.service_visits
      where vehicle_id = '00000000-0000-4000-8000-00000000c302')
    then raise exception 'Cross-owner service history read succeeded'; end if;
  if exists (select 1 from public.service_operations so
      join public.service_visits sv on sv.id = so.service_visit_id
      where sv.vehicle_id = '00000000-0000-4000-8000-00000000c302')
    then raise exception 'Cross-owner operation read succeeded'; end if;
  begin
    update public.service_visits set notes = 'Fictional unauthorized edit'
      where vehicle_id = '00000000-0000-4000-8000-00000000c302';
    raise exception 'Direct visit update unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
  begin
    perform public.delete_service_visit(
      '00000000-0000-4000-8000-00000000c302',
      '00000000-0000-4000-8000-00000000c301'
    );
    raise exception 'Cross-owner visit deletion succeeded';
  exception when insufficient_privilege then null; end;
  begin
    perform public.save_service_visit(
      '00000000-0000-4000-8000-00000000c302', null,
      jsonb_build_object(
        'service_date', current_date::text, 'mileage', 10000,
        'service_type', 'diy', 'workshop_name', null, 'operations',
        jsonb_build_array(jsonb_build_object(
          'maintenance_item_id', null, 'operation_name', 'Fictional unauthorized entry',
          'next_interval_km', null, 'next_interval_months', null
        ))
      )
    );
    raise exception 'Cross-owner service visit creation succeeded';
  exception when insufficient_privilege then null; end;
end;
$$;

set local role anon;
set local request.jwt.claims = '{}';
do $$
begin
  begin
    perform id from public.service_visits limit 1;
    raise exception 'Anonymous service-history read succeeded';
  exception when insufficient_privilege then null; end;
end;
$$;

reset role;
rollback;
select 'PASS: service-history RLS, atomic CRUD, immutable completion baseline, owner isolation, validation and mileage consistency' as result;
