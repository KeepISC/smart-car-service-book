-- Local/CI only. Existing completions remain the fallback without synthetic visits.
begin;
do $$
begin
  if (select history_status from public.vehicle_maintenance_items
      where id = '00000000-0000-4000-8000-00000000e303') <> 'known'
    or (select last_completed_date from public.vehicle_maintenance_items
      where id = '00000000-0000-4000-8000-00000000e303') <> current_date - 37
    or (select last_completed_mileage from public.vehicle_maintenance_items
      where id = '00000000-0000-4000-8000-00000000e303') <> 30000
  then raise exception 'Existing known completion values changed during migration'; end if;
  if (select history_status from public.vehicle_maintenance_items
      where id = '00000000-0000-4000-8000-00000000e304') <> 'not_applicable'
  then raise exception 'Existing not-applicable status changed during migration'; end if;
  if exists (select 1 from public.service_visits
      where vehicle_id = '00000000-0000-4000-8000-00000000e302')
  then raise exception 'Migration created fabricated service visits'; end if;
end;
$$;
delete from app_private.app_users where id = '00000000-0000-4000-8000-00000000e301';
commit;
select 'PASS: original completion and status preserved; no synthetic service entries created' as result;
