-- Disposable PostgreSQL only. All fictional fixtures and writes roll back.
begin;
update app_private.firebase_config set project_id='fictional-compatibility';
insert into app_private.app_users(id) values
 ('00000000-0000-4000-8000-00000000c601'),('00000000-0000-4000-8000-00000000d601');
insert into app_private.firebase_identities(firebase_uid,owner_id) values
 ('fictional-compat-c','00000000-0000-4000-8000-00000000c601'),('fictional-compat-d','00000000-0000-4000-8000-00000000d601');
insert into app_private.firebase_provisioning_approvals(firebase_uid) values ('fictional-compat-c'),('fictional-compat-d');
insert into public.vehicles(id,owner_id,type,make,model,year,engine,mileage) values
 ('00000000-0000-4000-8000-00000000c602','00000000-0000-4000-8000-00000000c601','car','Fictional','Legacy compatibility',2020,'Example',50000);
insert into public.vehicle_maintenance_items(id,vehicle_id,name,interval_km,history_status,last_completed_date,last_completed_mileage) values
 ('00000000-0000-4000-8000-00000000c603','00000000-0000-4000-8000-00000000c602','Fictional baseline',10000,'known',current_date-30,10000);
set local request.jwt.claims='{"iss":"https://securetoken.google.com/fictional-compatibility","aud":"fictional-compatibility","sub":"fictional-compat-c","role":"authenticated","email_verified":true,"app_owner_id":"00000000-0000-4000-8000-00000000c601"}';
set local role authenticated;
do $$
declare visit_id uuid; source_constraint text;
begin
  -- Legacy manual corrections remain valid before a schedule has linked visits.
  update public.vehicle_maintenance_items set last_completed_mileage=12000
    where id='00000000-0000-4000-8000-00000000c603';
  if (select last_completed_mileage from public.vehicle_maintenance_items where id='00000000-0000-4000-8000-00000000c603')<>12000
    then raise exception 'Unlinked legacy completion edit failed'; end if;
  begin
    update public.vehicle_maintenance_items set last_completed_mileage=50001 where id='00000000-0000-4000-8000-00000000c603';
    raise exception 'Legacy mileage invariant was weakened';
  exception when check_violation then null; end;
  begin
    update public.vehicle_maintenance_items set history_status='unknown' where id='00000000-0000-4000-8000-00000000c603';
    raise exception 'Malformed legacy status unexpectedly succeeded';
  exception when check_violation then null; end;
  begin
    update public.vehicle_maintenance_items set last_completed_date='-infinity' where id='00000000-0000-4000-8000-00000000c603';
    raise exception 'Non-finite legacy completion unexpectedly succeeded';
  exception when check_violation then null; end;
  visit_id:=public.save_service_visit('00000000-0000-4000-8000-00000000c602',null,jsonb_build_object(
    'service_date',(current_date-1)::text,'mileage',30000,'service_type','diy','operations',jsonb_build_array(jsonb_build_object(
      'maintenance_item_id','00000000-0000-4000-8000-00000000c603','operation_name','Fictional linked work','next_interval_km',6000
    ))));
  -- The unchanged legacy payload must keep ordinary edits working after linking.
  update public.vehicle_maintenance_items set name='Fictional legacy edit',interval_km=15000,
    history_status='known',last_completed_date=current_date-30,last_completed_mileage=12000
    where id='00000000-0000-4000-8000-00000000c603';
  -- Updated feature-enabled clients omit completion fields altogether.
  update public.vehicle_maintenance_items set interval_months=18 where id='00000000-0000-4000-8000-00000000c603';
  begin
    update public.vehicle_maintenance_items set name='Fictional rejected combined edit',last_completed_mileage=35000
      where id='00000000-0000-4000-8000-00000000c603';
    raise exception 'Linked completion override unexpectedly succeeded';
  exception when check_violation then
    get stacked diagnostics source_constraint=constraint_name;
    if source_constraint<>'maintenance_completion_source_conflict' then raise; end if;
  end;
  begin
    update public.vehicle_maintenance_items set history_status='unknown',last_completed_date=null,last_completed_mileage=null
      where id='00000000-0000-4000-8000-00000000c603';
    raise exception 'Clearing a linked baseline unexpectedly succeeded';
  exception when check_violation then
    get stacked diagnostics source_constraint=constraint_name;
    if source_constraint<>'maintenance_completion_source_conflict' then raise; end if;
  end;
  if (select name from public.vehicle_maintenance_items where id='00000000-0000-4000-8000-00000000c603')<>'Fictional legacy edit'
    or (select last_completed_mileage from public.vehicle_maintenance_items where id='00000000-0000-4000-8000-00000000c603')<>12000
    or (select next_interval_km from public.service_operations where service_visit_id=visit_id)<>6000
    then raise exception 'Rejected edit corrupted baseline, schedule or override'; end if;
  perform public.delete_service_visit('00000000-0000-4000-8000-00000000c602',visit_id);
  -- With no linked source remaining, the preserved baseline is editable again.
  update public.vehicle_maintenance_items set last_completed_mileage=14000 where id='00000000-0000-4000-8000-00000000c603';
end;
$$;
set local request.jwt.claims='{"iss":"https://securetoken.google.com/fictional-compatibility","aud":"fictional-compatibility","sub":"fictional-compat-d","role":"authenticated","email_verified":true,"app_owner_id":"00000000-0000-4000-8000-00000000d601"}';
do $$
declare affected integer;
begin
  update public.vehicle_maintenance_items set last_completed_mileage=45000 where id='00000000-0000-4000-8000-00000000c603';
  get diagnostics affected=row_count;
  if affected<>0 then raise exception 'Cross-owner legacy completion write succeeded'; end if;
  if exists(select 1 from public.vehicle_maintenance_items where id='00000000-0000-4000-8000-00000000c603')
    then raise exception 'Cross-owner legacy read succeeded'; end if;
end;
$$;
-- A forged owner UUID does not override the stable Firebase identity mapping.
set local request.jwt.claims='{"iss":"https://securetoken.google.com/fictional-compatibility","aud":"fictional-compatibility","sub":"fictional-compat-d","role":"authenticated","email_verified":true,"app_owner_id":"00000000-0000-4000-8000-00000000c601"}';
do $$ begin
  if public.current_app_owner() is not null then raise exception 'Forged owner claim accepted'; end if;
end; $$;
reset role;
rollback;
select 'PASS: guarded legacy writes, unchanged cached payloads, linked-source rejection, rollback, validation and Firebase ownership' as result;
