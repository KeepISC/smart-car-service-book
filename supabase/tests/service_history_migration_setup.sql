-- Local/CI fixture only. The following migration test removes these fictional records.
begin;
insert into app_private.app_users(id)
values ('00000000-0000-4000-8000-00000000e301');
insert into public.vehicles(
  id, owner_id, type, make, model, year, engine, mileage
) values (
  '00000000-0000-4000-8000-00000000e302',
  '00000000-0000-4000-8000-00000000e301',
  'car', 'Fictional Motors', 'Legacy Baseline', 2020, 'Example', 40000
);
insert into public.vehicle_maintenance_items(
  id, vehicle_id, name, interval_km, interval_months, history_status,
  last_completed_date, last_completed_mileage
) values
  ('00000000-0000-4000-8000-00000000e303',
   '00000000-0000-4000-8000-00000000e302',
   'Fictional known legacy completion', 10000, 12, 'known',
   current_date - 37, 30000),
  ('00000000-0000-4000-8000-00000000e304',
   '00000000-0000-4000-8000-00000000e302',
   'Fictional not-applicable legacy status', 5000, 6, 'not_applicable',
   null, null);
commit;
