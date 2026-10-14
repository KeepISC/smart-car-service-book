begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.vehicles, public.service_visits, public.service_operations in share row exclusive mode;

-- Future shop grants must bind to this epoch as well as the vehicle ID.
-- No shop access is granted by a transfer or by a workshop name on a visit.
alter table public.vehicles add column ownership_epoch bigint not null default 0 check (ownership_epoch >= 0);
alter table public.service_visits add column private_on_transfer boolean not null default false;

-- Legacy direct DELETE evaluates vehicle RLS before it waits on child rows.
-- Require a parent-first RPC to close that stale-authorization race without
-- introducing a child-first trigger that could deadlock Service History saves.
revoke delete on public.vehicle_maintenance_items from authenticated;
create function public.delete_vehicle_maintenance_item(p_vehicle_id uuid, p_item_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.vehicles v
    where v.id = p_vehicle_id and v.owner_id = public.current_app_owner() for update;
  if not found then
    raise exception 'Vehicle is unavailable or access is denied' using errcode = '42501';
  end if;
  delete from public.vehicle_maintenance_items where id = p_item_id and vehicle_id = p_vehicle_id;
  if not found then
    raise exception 'The maintenance item is unavailable' using errcode = '42501';
  end if;
end;
$$;
revoke all on function public.delete_vehicle_maintenance_item(uuid, uuid) from public, anon, authenticated;
grant execute on function public.delete_vehicle_maintenance_item(uuid, uuid) to authenticated;

create table app_private.vehicle_transfer_invitations (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  sender_id uuid not null references app_private.app_users(id),
  ownership_epoch bigint not null,
  token_hash bytea not null unique check (octet_length(token_hash) = 32),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'revoked')),
  resolved_at timestamptz,
  recipient_id uuid references app_private.app_users(id),
  check (expires_at > created_at and expires_at <= created_at + interval '7 days'),
  check ((status = 'pending' and resolved_at is null and recipient_id is null)
    or (status = 'revoked' and resolved_at is not null and recipient_id is null)
    or (status in ('accepted', 'declined') and resolved_at is not null and recipient_id is not null and recipient_id <> sender_id))
);
create unique index vehicle_transfer_one_pending_idx
  on app_private.vehicle_transfer_invitations(vehicle_id) where status = 'pending';

-- Preserve original private records without any former-owner or recipient read
-- path. Public rows keep only completion facts used by the existing calculator.
create table app_private.transfer_private_service_history (
  invitation_id uuid not null references app_private.vehicle_transfer_invitations(id) on delete cascade,
  visit_id uuid not null,
  original_visit jsonb not null,
  original_operations jsonb not null,
  primary key (invitation_id, visit_id)
);
alter table app_private.vehicle_transfer_invitations enable row level security;
alter table app_private.vehicle_transfer_invitations force row level security;
alter table app_private.transfer_private_service_history enable row level security;
alter table app_private.transfer_private_service_history force row level security;
revoke all on app_private.vehicle_transfer_invitations, app_private.transfer_private_service_history
  from public, anon, authenticated;

create function public.create_vehicle_transfer(p_vehicle_id uuid, p_expires_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  vehicle public.vehicles;
  actor uuid := public.current_app_owner();
  secret text;
  invitation app_private.vehicle_transfer_invitations;
  expiry timestamptz := coalesce(p_expires_at, clock_timestamp() + interval '1 day');
begin
  select v.* into vehicle from public.vehicles v
    where v.id = p_vehicle_id and v.owner_id = actor for update;
  if not found then
    raise exception 'Vehicle is unavailable or access is denied' using errcode = '42501';
  end if;
  if expiry <= clock_timestamp() or expiry > clock_timestamp() + interval '7 days' then
    raise exception 'Invitation expiry must be within seven days' using errcode = '22023';
  end if;
  -- Parent first, invitation second across every transfer entry point.
  update app_private.vehicle_transfer_invitations
    set status = 'revoked', resolved_at = clock_timestamp()
    where vehicle_id = vehicle.id and status = 'pending';
  -- Two independently random UUIDs supply 244 random bits without pgcrypto.
  secret := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into app_private.vehicle_transfer_invitations(vehicle_id, sender_id, ownership_epoch, token_hash, expires_at)
    values (vehicle.id, actor, vehicle.ownership_epoch, sha256(convert_to(secret, 'UTF8')), expiry)
    returning * into invitation;
  return jsonb_build_object('id', invitation.id, 'token', secret, 'expires_at', invitation.expires_at);
end;
$$;

-- Private helper acquires locks and rechecks every boundary after waiting.
-- Expiry uses wall-clock time, including transactions begun before expiry.
create function app_private.lock_vehicle_transfer(p_token text)
returns app_private.vehicle_transfer_invitations
language plpgsql security definer set search_path = '' as $$
declare
  invitation app_private.vehicle_transfer_invitations;
  vehicle public.vehicles;
  actor uuid := public.current_app_owner();
begin
  if actor is null or p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    raise exception 'Invitation is unavailable or access is denied' using errcode = '42501';
  end if;
  select i.* into invitation from app_private.vehicle_transfer_invitations i
    where i.token_hash = sha256(convert_to(p_token, 'UTF8'));
  if not found then
    raise exception 'Invitation is unavailable or access is denied' using errcode = '42501';
  end if;
  select v.* into vehicle from public.vehicles v where v.id = invitation.vehicle_id for update;
  if not found then
    raise exception 'Invitation is unavailable or access is denied' using errcode = '42501';
  end if;
  select i.* into invitation from app_private.vehicle_transfer_invitations i where i.id = invitation.id for update;
  if not found or invitation.status <> 'pending' or invitation.expires_at <= clock_timestamp()
    or vehicle.owner_id <> invitation.sender_id or vehicle.ownership_epoch <> invitation.ownership_epoch
    or actor = invitation.sender_id then
    raise exception 'Invitation is unavailable or access is denied' using errcode = '42501';
  end if;
  return invitation;
end;
$$;
revoke all on function app_private.lock_vehicle_transfer(text) from public, anon, authenticated;

create function public.preview_vehicle_transfer(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare invitation app_private.vehicle_transfer_invitations;
begin
  invitation := app_private.lock_vehicle_transfer(p_token);
  -- Deliberately limited preview: no owner identity, plate, VIN or history text.
  return (select jsonb_build_object('id', invitation.id, 'expires_at', invitation.expires_at,
    'vehicle', jsonb_build_object('id', v.id, 'type', v.type, 'make', v.make,
      'model', v.model, 'year', v.year, 'engine', v.engine, 'mileage', v.mileage))
    from public.vehicles v where v.id = invitation.vehicle_id);
end;
$$;

create function public.accept_vehicle_transfer(p_token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare invitation app_private.vehicle_transfer_invitations;
begin
  invitation := app_private.lock_vehicle_transfer(p_token);
  insert into app_private.transfer_private_service_history(invitation_id, visit_id, original_visit, original_operations)
    select invitation.id, sv.id, to_jsonb(sv), coalesce((
      select jsonb_agg(so order by so.id) from public.service_operations so where so.service_visit_id = sv.id
    ), '[]'::jsonb)
    from public.service_visits sv where sv.vehicle_id = invitation.vehicle_id and sv.private_on_transfer;
  -- No schedule/FK writes: avoids reversing the legacy schedule-delete lock order.
  -- Keep IDs, dates, mileage, created_at, links and one-time interval overrides.
  update public.service_operations so set operation_name = 'Private maintenance completion', cost = null
    from public.service_visits sv
    where sv.id = so.service_visit_id and sv.vehicle_id = invitation.vehicle_id and sv.private_on_transfer;
  update public.service_visits set workshop_name = null, total_cost = null, notes = null
    where vehicle_id = invitation.vehicle_id and private_on_transfer;
  if invitation.expires_at <= clock_timestamp() then
    raise exception 'Invitation is unavailable or access is denied' using errcode = '42501';
  end if;
  update public.vehicles set owner_id = public.current_app_owner(), ownership_epoch = ownership_epoch + 1
    where id = invitation.vehicle_id;
  update app_private.vehicle_transfer_invitations
    set status = 'accepted', resolved_at = clock_timestamp(), recipient_id = public.current_app_owner()
    where id = invitation.id;
  return invitation.vehicle_id;
end;
$$;

create function public.decline_vehicle_transfer(p_token text)
returns void language plpgsql security definer set search_path = '' as $$
declare invitation app_private.vehicle_transfer_invitations;
begin
  invitation := app_private.lock_vehicle_transfer(p_token);
  update app_private.vehicle_transfer_invitations
    set status = 'declined', resolved_at = clock_timestamp(), recipient_id = public.current_app_owner()
    where id = invitation.id;
end;
$$;

create function public.revoke_vehicle_transfer(p_vehicle_id uuid, p_invitation_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.vehicles v
    where v.id = p_vehicle_id and v.owner_id = public.current_app_owner() for update;
  if not found then
    raise exception 'Vehicle is unavailable or access is denied' using errcode = '42501';
  end if;
  update app_private.vehicle_transfer_invitations
    set status = 'revoked', resolved_at = clock_timestamp()
    where id = p_invitation_id and vehicle_id = p_vehicle_id
      and sender_id = public.current_app_owner() and status = 'pending';
  if not found then
    raise exception 'Invitation is unavailable or access is denied' using errcode = '42501';
  end if;
end;
$$;

create function public.set_service_visit_transfer_privacy(p_vehicle_id uuid, p_visit_id uuid, p_private boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_private is null then
    raise exception 'A privacy choice is required' using errcode = '22023';
  end if;
  -- Match the Service History parent row-version boundary for stale snapshots.
  update public.vehicles v set mileage = v.mileage
    where v.id = p_vehicle_id and v.owner_id = public.current_app_owner();
  if not found then
    raise exception 'Vehicle is unavailable or access is denied' using errcode = '42501';
  end if;
  update public.service_visits set private_on_transfer = p_private
    where id = p_visit_id and vehicle_id = p_vehicle_id;
  if not found then
    raise exception 'Service visit is unavailable or access is denied' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.create_vehicle_transfer(uuid, timestamptz),
  public.preview_vehicle_transfer(text), public.accept_vehicle_transfer(text),
  public.decline_vehicle_transfer(text), public.revoke_vehicle_transfer(uuid, uuid),
  public.set_service_visit_transfer_privacy(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.create_vehicle_transfer(uuid, timestamptz),
  public.preview_vehicle_transfer(text), public.accept_vehicle_transfer(text),
  public.decline_vehicle_transfer(text), public.revoke_vehicle_transfer(uuid, uuid),
  public.set_service_visit_transfer_privacy(uuid, uuid, boolean) to authenticated;

commit;
