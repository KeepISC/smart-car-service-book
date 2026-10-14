begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Existing approvals stay active. Deadlines apply only to pending requests.
alter table app_private.vehicle_shop_authorizations
  drop constraint vehicle_shop_authorizations_status_check;
alter table app_private.vehicle_shop_authorizations
  add constraint vehicle_shop_authorizations_status_check
    check (status in ('pending', 'approved', 'revoked', 'declined', 'cancelled', 'expired'));
alter table app_private.vehicle_shop_authorizations add column expires_at timestamptz;
update app_private.vehicle_shop_authorizations set expires_at = created_at + interval '1 day' where status = 'pending';
alter table app_private.vehicle_shop_authorizations add column resolved_at timestamptz;
alter table app_private.vehicle_shop_authorizations add constraint vehicle_shop_request_deadline
  check (status <> 'pending' or (expires_at is not null and expires_at > created_at and expires_at <= created_at + interval '7 days'));

-- Issuer generations prevent a removed/reinstated admin reviving an old link.
alter table app_private.repair_shop_staff add column access_version bigint not null default 0 check (access_version >= 0);
create function app_private.advance_shop_staff_version() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.access_version := old.access_version + 1;
  return new;
end;
$$;
revoke all on function app_private.advance_shop_staff_version() from public, anon, authenticated;
create trigger repair_shop_staff_access_version before update of role, active on app_private.repair_shop_staff
  for each row when ((old.role, old.active) is distinct from (new.role, new.active))
  execute function app_private.advance_shop_staff_version();

create table app_private.repair_shop_connection_invitations (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references app_private.repair_shops(id),
  issuer_id uuid not null references app_private.app_users(id),
  issuer_version bigint not null check (issuer_version >= 0),
  token_hash bytea not null unique check (octet_length(token_hash) = 32),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  resolved_at timestamptz,
  authorization_id uuid references app_private.vehicle_shop_authorizations(id) on delete cascade,
  check (expires_at > created_at and expires_at <= created_at + interval '7 days'),
  check ((status = 'pending') = (resolved_at is null)),
  check ((status = 'accepted') = (authorization_id is not null))
);
create index repair_shop_connection_invitations_shop_idx
  on app_private.repair_shop_connection_invitations(shop_id, created_at);
alter table app_private.repair_shop_connection_invitations enable row level security;
alter table app_private.repair_shop_connection_invitations force row level security;
revoke all on app_private.repair_shop_connection_invitations from public, anon, authenticated;

-- Retain the Task 7.1 signatures and permission boundaries; only add deadlines.
create or replace function public.request_vehicle_shop_authorization(p_vehicle_id uuid, p_shop_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare actor uuid := app_private.repair_shop_actor(); vehicle public.vehicles; authorization_id uuid;
begin
  select v.* into vehicle from public.vehicles v where v.id = p_vehicle_id for update;
  if not found then raise exception 'Vehicle is unavailable or access is denied' using errcode = '42501'; end if;
  if vehicle.owner_id = actor then
    perform 1 from app_private.repair_shops s where s.id = p_shop_id for share;
    if not found then raise exception 'Shop is unavailable' using errcode = '42501'; end if;
  else
    perform app_private.lock_repair_shop(p_shop_id, true, false);
  end if;
  update app_private.vehicle_shop_authorizations a set status = 'expired', resolved_at = clock_timestamp()
    where a.vehicle_id = p_vehicle_id and a.shop_id = p_shop_id and a.ownership_epoch = vehicle.ownership_epoch
      and a.status = 'pending' and a.expires_at <= clock_timestamp();
  insert into app_private.vehicle_shop_authorizations(shop_id, vehicle_id, ownership_epoch, initiated_by, expires_at)
    values (p_shop_id, p_vehicle_id, vehicle.ownership_epoch,
      case when vehicle.owner_id = actor then 'owner' else 'shop' end, clock_timestamp() + interval '1 day')
    on conflict (vehicle_id, shop_id, ownership_epoch) where status in ('pending', 'approved')
      do nothing returning id into authorization_id;
  if authorization_id is null then
    select a.id into authorization_id from app_private.vehicle_shop_authorizations a
      where a.vehicle_id = p_vehicle_id and a.shop_id = p_shop_id
        and a.ownership_epoch = vehicle.ownership_epoch and a.status in ('pending', 'approved');
  end if;
  return authorization_id;
end;
$$;

create or replace function public.approve_vehicle_shop_authorization(p_vehicle_id uuid, p_authorization_id uuid, p_can_create_records boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := app_private.repair_shop_actor(); vehicle public.vehicles;
begin
  update public.vehicles v set mileage = v.mileage
    where v.id = p_vehicle_id and v.owner_id = actor returning v.* into vehicle;
  if not found then raise exception 'Vehicle is unavailable or access is denied' using errcode = '42501'; end if;
  if p_can_create_records is null then raise exception 'Choose record creation permission' using errcode = '22023'; end if;
  update app_private.vehicle_shop_authorizations a set status = 'approved', approved_by = actor,
    approved_at = clock_timestamp(), can_create_records = p_can_create_records
    where a.id = p_authorization_id and a.vehicle_id = p_vehicle_id
      and a.ownership_epoch = vehicle.ownership_epoch and a.status = 'pending' and a.expires_at > clock_timestamp();
  if not found then raise exception 'Authorization is unavailable' using errcode = '42501'; end if;
end;
$$;

create function public.resolve_vehicle_shop_request(p_vehicle_id uuid, p_authorization_id uuid, p_outcome text)
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := app_private.repair_shop_actor(); vehicle public.vehicles; grant_record app_private.vehicle_shop_authorizations; is_owner boolean;
begin
  if p_outcome is null or p_outcome not in ('declined', 'cancelled', 'expired') then
    raise exception 'Choose decline, cancel or expiry' using errcode = '22023';
  end if;
  update public.vehicles v set mileage = v.mileage where v.id = p_vehicle_id returning v.* into vehicle;
  if not found then raise exception 'Vehicle is unavailable or access is denied' using errcode = '42501'; end if;
  select a.* into grant_record from app_private.vehicle_shop_authorizations a
    where a.id = p_authorization_id and a.vehicle_id = p_vehicle_id and a.ownership_epoch = vehicle.ownership_epoch;
  if not found or grant_record.status <> 'pending' then raise exception 'Request is unavailable' using errcode = '42501'; end if;
  is_owner := vehicle.owner_id = actor;
  if not is_owner then perform app_private.lock_repair_shop(grant_record.shop_id, true, false); end if;
  if p_outcome = 'expired' then
    if grant_record.expires_at > clock_timestamp() then raise exception 'Request has not expired' using errcode = '22023'; end if;
  elsif grant_record.expires_at <= clock_timestamp()
    or (p_outcome = 'cancelled' and is_owner <> (grant_record.initiated_by = 'owner'))
    or (p_outcome = 'declined' and is_owner = (grant_record.initiated_by = 'owner')) then
    raise exception 'Request is unavailable or access is denied' using errcode = '42501';
  end if;
  update app_private.vehicle_shop_authorizations set status = p_outcome, resolved_at = clock_timestamp()
    where id = p_authorization_id;
end;
$$;

create or replace function public.list_vehicle_shop_authorizations(p_vehicle_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid := app_private.repair_shop_actor(); vehicle public.vehicles;
begin
  select v.* into vehicle from public.vehicles v where v.id = p_vehicle_id and v.owner_id = actor for share;
  if not found then raise exception 'Vehicle is unavailable or access is denied' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'shop_id', a.shop_id, 'shop_name', s.name,
    'vehicle_id', a.vehicle_id, 'ownership_epoch', a.ownership_epoch, 'initiated_by', a.initiated_by,
    'status', case when a.status = 'pending' and a.expires_at <= clock_timestamp() then 'expired' else a.status end,
    'expires_at', a.expires_at, 'can_create_records', a.can_create_records) order by a.created_at, a.id), '[]'::jsonb)
    from app_private.vehicle_shop_authorizations a join app_private.repair_shops s on s.id = a.shop_id
    where a.vehicle_id = p_vehicle_id and a.ownership_epoch = vehicle.ownership_epoch);
end;
$$;

create or replace function public.list_repair_shop_authorizations(p_shop_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.lock_repair_shop(p_shop_id, false, false);
  return (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'shop_id', a.shop_id, 'shop_name', s.name,
    'vehicle_id', a.vehicle_id, 'ownership_epoch', a.ownership_epoch, 'initiated_by', a.initiated_by,
    'status', case when a.status = 'pending' and a.expires_at <= clock_timestamp() then 'expired' else a.status end,
    'expires_at', a.expires_at, 'can_create_records', a.can_create_records) order by a.created_at, a.id), '[]'::jsonb)
    from app_private.vehicle_shop_authorizations a join public.vehicles v on v.id = a.vehicle_id
    join app_private.repair_shops s on s.id = a.shop_id
    where a.shop_id = p_shop_id and a.ownership_epoch = v.ownership_epoch
      and (a.status <> 'approved' or a.approved_by = v.owner_id));
end;
$$;

create function public.create_repair_shop_connection_invitation(p_shop_id uuid, p_expires_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare secret text; invitation app_private.repair_shop_connection_invitations; version bigint; expiry timestamptz;
begin
  perform app_private.lock_repair_shop(p_shop_id, true, false);
  expiry := coalesce(p_expires_at, clock_timestamp() + interval '1 day');
  if expiry <= clock_timestamp() or expiry > clock_timestamp() + interval '7 days' then
    raise exception 'Invitation expiry must be within seven days' using errcode = '22023';
  end if;
  select m.access_version into version from app_private.repair_shop_staff m
    where m.shop_id = p_shop_id and m.user_id = app_private.repair_shop_actor();
  secret := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into app_private.repair_shop_connection_invitations(shop_id, issuer_id, issuer_version, token_hash, expires_at)
    values (p_shop_id, app_private.repair_shop_actor(), version, sha256(convert_to(secret, 'UTF8')), expiry)
    returning * into invitation;
  return jsonb_build_object('id', invitation.id, 'token', secret, 'expires_at', invitation.expires_at);
end;
$$;

-- Generic links reveal only the shop. No vehicle/owner is recorded until approval.
-- Acceptance locks vehicle first, then this helper locks shop, then invitation.
create function app_private.lock_shop_connection_invitation(p_token text)
returns app_private.repair_shop_connection_invitations
language plpgsql security definer set search_path = '' as $$
declare invitation app_private.repair_shop_connection_invitations;
begin
  perform app_private.repair_shop_actor();
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    raise exception 'Invitation is unavailable or access is denied' using errcode = '42501';
  end if;
  select i.* into invitation from app_private.repair_shop_connection_invitations i
    where i.token_hash = sha256(convert_to(p_token, 'UTF8'));
  if not found then raise exception 'Invitation is unavailable or access is denied' using errcode = '42501'; end if;
  perform 1 from app_private.repair_shops s where s.id = invitation.shop_id for share;
  select i.* into invitation from app_private.repair_shop_connection_invitations i where i.id = invitation.id for update;
  if invitation.status <> 'pending' or invitation.expires_at <= clock_timestamp() or not exists (
    select 1 from app_private.repair_shop_staff m
    join app_private.firebase_identities f on f.owner_id = m.user_id
    join app_private.firebase_provisioning_approvals a on a.firebase_uid = f.firebase_uid and a.enabled
    where m.shop_id = invitation.shop_id and m.user_id = invitation.issuer_id
      and m.active and m.role = 'admin' and m.access_version = invitation.issuer_version
  ) then raise exception 'Invitation is unavailable or access is denied' using errcode = '42501'; end if;
  return invitation;
end;
$$;

create function public.preview_repair_shop_connection_invitation(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare invitation app_private.repair_shop_connection_invitations;
begin
  invitation := app_private.lock_shop_connection_invitation(p_token);
  return (select jsonb_build_object('id', invitation.id, 'expires_at', invitation.expires_at,
    'shop', jsonb_build_object('id', s.id, 'name', s.name)) from app_private.repair_shops s where s.id = invitation.shop_id);
end;
$$;

create function public.accept_repair_shop_connection_invitation(p_token text, p_vehicle_id uuid, p_can_create_records boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor uuid := app_private.repair_shop_actor(); invitation app_private.repair_shop_connection_invitations;
  vehicle public.vehicles; saved_authorization_id uuid; previous_id uuid;
begin
  update public.vehicles v set mileage = v.mileage where v.id = p_vehicle_id and v.owner_id = actor returning v.* into vehicle;
  if not found then raise exception 'Vehicle is unavailable or access is denied' using errcode = '42501'; end if;
  invitation := app_private.lock_shop_connection_invitation(p_token);
  select a.id into previous_id from app_private.vehicle_shop_authorizations a
    where a.vehicle_id = p_vehicle_id and a.shop_id = invitation.shop_id and a.ownership_epoch = vehicle.ownership_epoch
      and (a.status = 'approved' or (a.status = 'pending' and a.expires_at > clock_timestamp()));
  -- Reuse the existing request and explicit owner approval RPCs atomically.
  saved_authorization_id := public.request_vehicle_shop_authorization(p_vehicle_id, invitation.shop_id);
  if saved_authorization_id is distinct from previous_id then
    update app_private.vehicle_shop_authorizations set initiated_by = 'shop' where id = saved_authorization_id;
  end if;
  perform public.approve_vehicle_shop_authorization(p_vehicle_id, saved_authorization_id, p_can_create_records);
  -- Wall-clock expiry is rechecked after all request/approval work, before consuming.
  if invitation.expires_at <= clock_timestamp() then raise exception 'Invitation is unavailable' using errcode = '42501'; end if;
  update app_private.repair_shop_connection_invitations set status = 'accepted', resolved_at = clock_timestamp(),
    authorization_id = saved_authorization_id where id = invitation.id;
  return saved_authorization_id;
end;
$$;

create function public.decline_repair_shop_connection_invitation(p_token text) returns void
language plpgsql security definer set search_path = '' as $$
declare invitation app_private.repair_shop_connection_invitations;
begin
  invitation := app_private.lock_shop_connection_invitation(p_token);
  update app_private.repair_shop_connection_invitations set status = 'declined', resolved_at = clock_timestamp() where id = invitation.id;
end;
$$;

create function public.cancel_repair_shop_connection_invitation(p_shop_id uuid, p_invitation_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.lock_repair_shop(p_shop_id, true, false);
  update app_private.repair_shop_connection_invitations set status = 'cancelled', resolved_at = clock_timestamp()
    where id = p_invitation_id and shop_id = p_shop_id and status = 'pending' and expires_at > clock_timestamp();
  if not found then raise exception 'Invitation is unavailable' using errcode = '42501'; end if;
end;
$$;

create function public.list_repair_shop_connection_invitations(p_shop_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.lock_repair_shop(p_shop_id, true, false);
  return (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'expires_at', i.expires_at,
    'status', case when i.status = 'pending' and i.expires_at <= clock_timestamp() then 'expired'
      when i.status = 'pending' and not exists (select 1 from app_private.repair_shop_staff m
        join app_private.firebase_identities f on f.owner_id = m.user_id
        join app_private.firebase_provisioning_approvals a on a.firebase_uid = f.firebase_uid and a.enabled
        where m.shop_id = i.shop_id and m.user_id = i.issuer_id and m.active and m.role = 'admin'
          and m.access_version = i.issuer_version) then 'cancelled' else i.status end)
    order by i.created_at, i.id), '[]'::jsonb) from app_private.repair_shop_connection_invitations i where i.shop_id = p_shop_id);
end;
$$;

revoke all on function app_private.lock_shop_connection_invitation(text) from public, anon, authenticated;
revoke all on function public.resolve_vehicle_shop_request(uuid, uuid, text),
  public.create_repair_shop_connection_invitation(uuid, timestamptz), public.preview_repair_shop_connection_invitation(text),
  public.accept_repair_shop_connection_invitation(text, uuid, boolean), public.decline_repair_shop_connection_invitation(text),
  public.cancel_repair_shop_connection_invitation(uuid, uuid), public.list_repair_shop_connection_invitations(uuid)
  from public, anon, authenticated;
grant execute on function public.resolve_vehicle_shop_request(uuid, uuid, text),
  public.create_repair_shop_connection_invitation(uuid, timestamptz), public.preview_repair_shop_connection_invitation(text),
  public.accept_repair_shop_connection_invitation(text, uuid, boolean), public.decline_repair_shop_connection_invitation(text),
  public.cancel_repair_shop_connection_invitation(uuid, uuid), public.list_repair_shop_connection_invitations(uuid) to authenticated;
notify pgrst, 'reload schema';
commit;
