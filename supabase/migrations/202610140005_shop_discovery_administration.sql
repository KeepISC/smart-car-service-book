begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create function public.platform_search_repair_shops(p_search text default '', p_status text default null,
  p_offset integer default 0, p_limit integer default 100) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare checked_at timestamptz;
begin
  perform app_private.lock_platform_administrator();
  if p_search is null or char_length(p_search)>128 or p_offset is null or p_offset<0 or p_limit is null or p_limit not between 1 and 200
    or (p_status is not null and p_status not in ('pending','active','disabled','suspended','not_started','expired')) then
    raise exception 'Invalid shop search or page' using errcode='22023'; end if;
  checked_at:=clock_timestamp();
  -- Count and page share one statement snapshot, including an empty/out-of-range page.
  return (with filtered as materialized (
    select s.*, case when s.suspended then 'suspended' when s.subscription_status<>'active' then s.subscription_status
      when s.subscription_starts_at>checked_at then 'not_started' when s.subscription_ends_at<=checked_at then 'expired' else 'active' end access_status
    from app_private.repair_shops s where strpos(lower(s.name || ' ' || s.id::text),lower(btrim(p_search)))>0
  ), matched as materialized (select * from filtered where p_status is null or access_status=p_status),
  page as (select * from matched order by id offset p_offset limit p_limit)
  select jsonb_build_object('items',(select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]'::jsonb) from page p),
    'total',(select count(*) from matched),'offset',p_offset,'limit',p_limit));
end;
$$;
-- Preserve existing callers and their array response, with one search implementation.
create or replace function public.platform_list_repair_shops(p_offset integer default 0,p_limit integer default 100) returns jsonb
language sql security definer set search_path = '' as $$
  select public.platform_search_repair_shops('',null,p_offset,p_limit)->'items';
$$;

create function public.platform_list_shop_administrators(p_shop_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.lock_platform_administrator();
  perform 1 from app_private.repair_shops s where s.id=p_shop_id for share;
  if not found then raise exception 'Shop is unavailable' using errcode='42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('firebase_uid',f.firebase_uid,'enabled',coalesce(a.enabled,false)) order by f.firebase_uid),'[]'::jsonb)
    from app_private.repair_shop_staff m join app_private.firebase_identities f on f.owner_id=m.user_id
      left join app_private.firebase_provisioning_approvals a using(firebase_uid)
    where m.shop_id=p_shop_id and m.active and m.role='admin');
end;
$$;
create function public.platform_find_provisioned_users(p_search text,p_offset integer default 0,p_limit integer default 20) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.lock_platform_administrator();
  if p_search is null or char_length(btrim(p_search)) not between 3 and 128 or p_offset is null or p_offset<0
    or p_limit is null or p_limit not between 1 and 50 then raise exception 'Enter a UID search and valid page' using errcode='22023'; end if;
  -- Only provisioned/enabled identities, never emails, owner IDs, auth exports or claims.
  return (with matches as materialized (
    select f.firebase_uid from app_private.firebase_identities f join app_private.firebase_provisioning_approvals a using(firebase_uid)
      where a.enabled and strpos(lower(f.firebase_uid),lower(btrim(p_search)))>0
  ) select jsonb_build_object('items',(select coalesce(jsonb_agg(to_jsonb(p) order by p.firebase_uid),'[]'::jsonb)
    from (select * from matches order by firebase_uid offset p_offset limit p_limit) p),
    'total',(select count(*) from matches),'offset',p_offset,'limit',p_limit));
end;
$$;

create function public.search_available_repair_shops(p_vehicle_id uuid,p_search text default '',p_offset integer default 0,p_limit integer default 20) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid := app_private.repair_shop_actor(); checked_at timestamptz;
begin
  perform 1 from public.vehicles v where v.id=p_vehicle_id and v.owner_id=actor for share;
  if not found then raise exception 'Vehicle is unavailable' using errcode='42501'; end if;
  if p_search is null or char_length(p_search)>128 or p_offset is null or p_offset<0 or p_limit is null or p_limit not between 1 and 100 then
    raise exception 'Invalid directory search or page' using errcode='22023'; end if;
  checked_at:=clock_timestamp();
  return (with eligible as materialized (
    select s.id,s.name,s.contact_address,s.contact_phone,s.contact_website from app_private.repair_shops s
    where not s.suspended and s.subscription_status='active' and s.subscription_starts_at<=checked_at and s.subscription_ends_at>checked_at
      and strpos(lower(s.name || ' ' || coalesce(s.contact_address,'')),lower(btrim(p_search)))>0
      and exists(select 1 from app_private.repair_shop_staff m join app_private.firebase_identities f on f.owner_id=m.user_id
        join app_private.firebase_provisioning_approvals a using(firebase_uid) where m.shop_id=s.id and m.active and m.role='admin' and a.enabled)
      and (s.max_connected_vehicles is null or (select count(*) from app_private.vehicle_shop_authorizations a join public.vehicles v on v.id=a.vehicle_id
        where a.shop_id=s.id and a.status='approved' and a.ownership_epoch=v.ownership_epoch and a.approved_by=v.owner_id)<s.max_connected_vehicles
        or exists(select 1 from app_private.vehicle_shop_authorizations a join public.vehicles v on v.id=a.vehicle_id
          where a.shop_id=s.id and a.vehicle_id=p_vehicle_id and a.status='approved' and a.ownership_epoch=v.ownership_epoch and a.approved_by=actor))
  ) select jsonb_build_object('items',(select coalesce(jsonb_agg(to_jsonb(p) order by lower(p.name),p.id),'[]'::jsonb)
    from (select * from eligible order by lower(name),id offset p_offset limit p_limit) p),'total',(select count(*) from eligible),'offset',p_offset,'limit',p_limit));
end;
$$;
revoke all on function public.platform_search_repair_shops(text,text,integer,integer),public.platform_list_shop_administrators(uuid),
  public.platform_find_provisioned_users(text,integer,integer),public.search_available_repair_shops(uuid,text,integer,integer) from public,anon,authenticated;
grant execute on function public.platform_search_repair_shops(text,text,integer,integer),public.platform_list_shop_administrators(uuid),
  public.platform_find_provisioned_users(text,integer,integer),public.search_available_repair_shops(uuid,text,integer,integer) to authenticated;
notify pgrst,'reload schema';
commit;
