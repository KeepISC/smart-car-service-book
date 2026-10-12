-- Disposable CI only: seed legacy ownership BEFORE the identity migration.
insert into auth.users (id, aud, role, email) values
  ('00000000-0000-4000-8000-00000000a101','authenticated','authenticated','legacy@example.invalid');
insert into public.vehicles (id,owner_id,type,make,model,year,engine,mileage) values
  ('00000000-0000-4000-8000-00000000a102','00000000-0000-4000-8000-00000000a101','car','Fictional Motors','Preserved example',2020,'Example',1234);
insert into public.vehicle_maintenance_items(id,vehicle_id,name,interval_months) values
  ('00000000-0000-4000-8000-00000000a103','00000000-0000-4000-8000-00000000a102','Preserved operation',12);
