begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table app_private.vehicle_shop_authorizations
  add column shop_accepted_at timestamptz,
  add column customer_display_reference text check(customer_display_reference is null or char_length(btrim(customer_display_reference)) between 1 and 80),
  add column share_operation_names boolean not null default false;
create table app_private.shop_service_record_shares (
  authorization_id uuid not null references app_private.vehicle_shop_authorizations(id) on delete cascade,
  visit_id uuid not null references public.service_visits(id) on delete cascade,
  primary key(authorization_id,visit_id)
);
alter table app_private.shop_service_record_shares enable row level security;
alter table app_private.shop_service_record_shares force row level security;
revoke all on app_private.shop_service_record_shares from public,anon,authenticated;

create function public.review_owner_shop_request(p_vehicle_id uuid,p_authorization_id uuid,p_outcome text) returns void
language plpgsql security definer set search_path = '' as $$
declare vehicle public.vehicles; request app_private.vehicle_shop_authorizations;
begin
  if p_outcome is null or p_outcome not in ('accepted','declined') then raise exception 'Invalid shop response' using errcode='22023'; end if;
  update public.vehicles v set mileage=v.mileage where v.id=p_vehicle_id returning v.* into vehicle;
  if not found then raise exception 'Vehicle is unavailable' using errcode='42501'; end if;
  select a.* into request from app_private.vehicle_shop_authorizations a where a.id=p_authorization_id and a.vehicle_id=vehicle.id and a.ownership_epoch=vehicle.ownership_epoch;
  if not found then raise exception 'Request is unavailable' using errcode='42501'; end if;
  perform app_private.lock_repair_shop(request.shop_id,true,true);
  if request.initiated_by<>'owner' or request.status<>'pending' or request.expires_at<=clock_timestamp() then
    raise exception 'Request is unavailable' using errcode='42501'; end if;
  if p_outcome='declined' then
    perform public.resolve_vehicle_shop_request(p_vehicle_id,p_authorization_id,'declined');
  else
    -- Acceptance acknowledges the request only: it never grants view/write access.
    update app_private.vehicle_shop_authorizations set shop_accepted_at=coalesce(shop_accepted_at,clock_timestamp()) where id=request.id;
  end if;
  perform app_private.require_shop_access(request.shop_id);
end;
$$;

create function public.set_vehicle_shop_data_sharing(p_vehicle_id uuid,p_authorization_id uuid,p_customer_reference text,
  p_share_operation_names boolean,p_shared_visit_ids uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare vehicle public.vehicles; request app_private.vehicle_shop_authorizations; visit_id uuid; actor uuid:=app_private.repair_shop_actor();
begin
  update public.vehicles v set mileage=v.mileage where v.id=p_vehicle_id and v.owner_id=actor returning v.* into vehicle;
  if not found then raise exception 'Vehicle is unavailable' using errcode='42501'; end if;
  select a.* into request from app_private.vehicle_shop_authorizations a where a.id=p_authorization_id and a.vehicle_id=vehicle.id
    and a.ownership_epoch=vehicle.ownership_epoch and a.status='approved' and a.approved_by=actor;
  if not found then raise exception 'Authorization is unavailable' using errcode='42501'; end if;
  -- Owners may withdraw sharing even while a shop is suspended/expired.
  if p_share_operation_names is null or p_shared_visit_ids is null or cardinality(p_shared_visit_ids)>1000
    or array_position(p_shared_visit_ids,null) is not null or (p_customer_reference is not null and char_length(btrim(p_customer_reference)) not between 1 and 80) then
    raise exception 'Invalid sharing choices' using errcode='22023'; end if;
  for visit_id in select distinct id from unnest(p_shared_visit_ids) id order by id loop
    perform 1 from public.service_visits sv where sv.id=visit_id and sv.vehicle_id=vehicle.id and not sv.private_on_transfer for share;
    if not found then raise exception 'Shared visit is unavailable or private' using errcode='42501'; end if;
  end loop;
  update app_private.vehicle_shop_authorizations set customer_display_reference=btrim(p_customer_reference),share_operation_names=p_share_operation_names where id=request.id;
  delete from app_private.shop_service_record_shares where authorization_id=request.id;
  insert into app_private.shop_service_record_shares(authorization_id,visit_id) select request.id,id from unnest(p_shared_visit_ids) id on conflict do nothing;
end;
$$;

-- Retain the existing sanitizer as the default/facts-only projection.
alter function public.get_repair_shop_vehicle(uuid,uuid) rename to base_get_repair_shop_vehicle;
alter function public.base_get_repair_shop_vehicle(uuid,uuid) set schema app_private;
create function public.get_repair_shop_vehicle(p_shop_id uuid,p_vehicle_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare request app_private.vehicle_shop_authorizations; result jsonb;
begin
  request:=app_private.lock_shop_vehicle(p_shop_id,p_vehicle_id,false);
  result:=app_private.base_get_repair_shop_vehicle(p_shop_id,p_vehicle_id);
  result:=result || jsonb_build_object('customer_reference',coalesce(request.customer_display_reference,'Customer ' || request.id::text));
  if request.share_operation_names then
    result:=jsonb_set(result,'{maintenance_schedules}',(select coalesce(jsonb_agg(entry || jsonb_build_object('name',m.name) order by position),'[]'::jsonb)
      from jsonb_array_elements(result->'maintenance_schedules') with ordinality as x(entry,position)
      join public.vehicle_maintenance_items m on m.id=(entry->>'id')::uuid and m.vehicle_id=p_vehicle_id));
  end if;
  result:=jsonb_set(result,'{maintenance_records}',(select coalesce(jsonb_agg(
    case when shared.visit_id is not null and not sv.private_on_transfer then entry || jsonb_build_object(
      'notes',sv.notes,'total_cost',sv.total_cost,'service_type',sv.service_type,'workshop_name',sv.workshop_name,
      'workshop_provenance',(select jsonb_build_object('shop_id',r.shop_id,'shop_name',s.name,'recorded_at',r.recorded_at)
        from app_private.repair_shop_service_records r join app_private.vehicle_shop_authorizations a on a.id=r.authorization_id
          join app_private.repair_shops s on s.id=r.shop_id join public.vehicles v on v.id=a.vehicle_id
        where r.visit_id=sv.id and a.ownership_epoch=v.ownership_epoch and a.approved_by=v.owner_id),
      'operations',(select coalesce(jsonb_agg(jsonb_build_object('maintenance_item_id',o.maintenance_item_id,'next_interval_km',o.next_interval_km,
        'next_interval_months',o.next_interval_months,'operation_name',o.operation_name,'cost',o.cost) order by o.id),'[]'::jsonb)
        from public.service_operations o where o.service_visit_id=sv.id)) else entry end order by position),'[]'::jsonb)
    from jsonb_array_elements(result->'maintenance_records') with ordinality as x(entry,position)
      join public.service_visits sv on sv.id=(entry->>'id')::uuid and sv.vehicle_id=p_vehicle_id
      left join app_private.shop_service_record_shares shared on shared.visit_id=sv.id and shared.authorization_id=request.id));
  return result;
end;
$$;

-- Extend the existing lists without duplicating their ownership/expiry checks.
alter function public.list_vehicle_shop_authorizations(uuid) rename to base_list_vehicle_shop_authorizations;
alter function public.base_list_vehicle_shop_authorizations(uuid) set schema app_private;
alter function public.list_repair_shop_authorizations(uuid) rename to base_list_repair_shop_authorizations;
alter function public.base_list_repair_shop_authorizations(uuid) set schema app_private;
create function app_private.shop_request_metadata(p_rows jsonb) returns jsonb
language sql security definer set search_path = '' as $$
  select coalesce(jsonb_agg(entry || jsonb_build_object('shop_accepted_at',a.shop_accepted_at) || case when a.status='approved' then jsonb_build_object('share_operation_names',a.share_operation_names,
    'customer_reference',a.customer_display_reference,'shared_visit_ids',(select coalesce(jsonb_agg(s.visit_id order by s.visit_id),'[]'::jsonb)
      from app_private.shop_service_record_shares s where s.authorization_id=a.id)) else '{}'::jsonb end order by position),'[]'::jsonb)
    from jsonb_array_elements(p_rows) with ordinality as x(entry,position) join app_private.vehicle_shop_authorizations a on a.id=(entry->>'id')::uuid;
$$;
create function public.list_vehicle_shop_authorizations(p_vehicle_id uuid) returns jsonb
language sql security definer set search_path = '' as $$ select app_private.shop_request_metadata(app_private.base_list_vehicle_shop_authorizations(p_vehicle_id)); $$;
create function public.list_repair_shop_authorizations(p_shop_id uuid) returns jsonb
language sql security definer set search_path = '' as $$ select app_private.shop_request_metadata(app_private.base_list_repair_shop_authorizations(p_shop_id)); $$;

revoke all on function app_private.base_get_repair_shop_vehicle(uuid,uuid),app_private.base_list_vehicle_shop_authorizations(uuid),
  app_private.base_list_repair_shop_authorizations(uuid),app_private.shop_request_metadata(jsonb) from public,anon,authenticated;
revoke all on function public.review_owner_shop_request(uuid,uuid,text),public.set_vehicle_shop_data_sharing(uuid,uuid,text,boolean,uuid[]),
  public.get_repair_shop_vehicle(uuid,uuid),public.list_vehicle_shop_authorizations(uuid),public.list_repair_shop_authorizations(uuid) from public,anon,authenticated;
grant execute on function public.review_owner_shop_request(uuid,uuid,text),public.set_vehicle_shop_data_sharing(uuid,uuid,text,boolean,uuid[]),
  public.get_repair_shop_vehicle(uuid,uuid),public.list_vehicle_shop_authorizations(uuid),public.list_repair_shop_authorizations(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
