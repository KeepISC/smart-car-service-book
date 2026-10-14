begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Retain the same token/identity/expiry/epoch lock boundary. Preview contains
-- only facts; even shared free-text fields can contain owner information.
create or replace function public.preview_vehicle_transfer(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare invitation app_private.vehicle_transfer_invitations;
begin
  invitation := app_private.lock_vehicle_transfer(p_token);
  return (select jsonb_build_object('id', invitation.id, 'expires_at', invitation.expires_at,
    'vehicle', jsonb_build_object('id', v.id, 'type', v.type, 'make', v.make,
      'model', v.model, 'year', v.year, 'engine', v.engine, 'mileage', v.mileage),
    'maintenance_schedules', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'interval_km', m.interval_km,
        'interval_months', m.interval_months, 'enabled', m.enabled,
        'history_status', m.history_status, 'last_completed_date', m.last_completed_date,
        'last_completed_mileage', m.last_completed_mileage) order by m.created_at, m.id)
      from public.vehicle_maintenance_items m where m.vehicle_id = v.id
    ), '[]'::jsonb),
    'maintenance_records', coalesce((
      select jsonb_agg(jsonb_build_object('id', sv.id, 'service_date', sv.service_date,
        'mileage', sv.mileage, 'private_on_transfer', sv.private_on_transfer,
        'operations', coalesce((select jsonb_agg(jsonb_build_object(
          'maintenance_item_id', so.maintenance_item_id,
          'next_interval_km', so.next_interval_km, 'next_interval_months', so.next_interval_months)
          order by so.id) from public.service_operations so where so.service_visit_id = sv.id), '[]'::jsonb))
        order by sv.service_date desc, sv.mileage desc, sv.created_at desc, sv.id)
      from public.service_visits sv where sv.vehicle_id = v.id
    ), '[]'::jsonb)) from public.vehicles v where v.id = invitation.vehicle_id);
end;
$$;
revoke all on function public.preview_vehicle_transfer(text) from public, anon;
grant execute on function public.preview_vehicle_transfer(text) to authenticated;

-- Sender may read only the outcome of an invitation they created, even after
-- losing vehicle access. This grants no vehicle or recipient identity access.
create function public.vehicle_transfer_status(p_vehicle_id uuid, p_invitation_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare invitation app_private.vehicle_transfer_invitations;
begin
  select i.* into invitation from app_private.vehicle_transfer_invitations i
    where i.id = p_invitation_id and i.vehicle_id = p_vehicle_id
      and i.sender_id = public.current_app_owner();
  if not found then
    raise exception 'Invitation is unavailable or access is denied' using errcode = '42501';
  end if;
  if invitation.status = 'pending' and invitation.expires_at <= clock_timestamp() then
    return 'expired';
  end if;
  return invitation.status;
end;
$$;
revoke all on function public.vehicle_transfer_status(uuid, uuid) from public, anon;
grant execute on function public.vehicle_transfer_status(uuid, uuid) to authenticated;
notify pgrst, 'reload schema';
commit;
