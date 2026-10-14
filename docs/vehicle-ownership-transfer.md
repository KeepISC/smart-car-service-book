# Vehicle ownership transfer

## Contract

`create_vehicle_transfer(vehicle_id, expires_at)` requires the current vehicle
owner and returns an invitation ID, expiry and a token **once**. The default
expiry is one day; the maximum is seven days. Only SHA-256 hashes are stored.
Creating a replacement revokes the previous pending invitation for that vehicle.
`revoke_vehicle_transfer(vehicle_id, invitation_id)` requires its current sender.

The token is an authenticated bearer capability: any recognized application user
holding it, except the sender, can preview, accept or decline. There is no email
lookup, recipient UUID input, account enumeration or invitation delivery service.
Deliver the token to the intended recipient through a private channel. Callers
must keep it out of logs, analytics, persistent browser storage and URL query
parameters. Incomplete flows use `sessionStorage` for same-tab reload recovery;
tokens are cleared on acceptance, decline, revocation or expiry, and on sign-out
or an account change. A new fragment replaces any previous recipient token.
If session storage is blocked, the current flow still works in memory.
Preview exposes vehicle ID, type, make, model, year, engine, mileage, invitation
expiry, schedule intervals/baselines and service completion facts; it grants no
table access. Both private and shared free-text labels, notes, workshop details,
costs and owner information are excluded from the maintenance preview.

`preview_vehicle_transfer(token)`, `accept_vehicle_transfer(token)` and
`decline_vehicle_transfer(token)` use `current_app_owner()` and reject malformed,
expired, revoked, consumed, self-directed and stale-ownership invitations.
Acceptance returns the vehicle UUID. Decline consumes the invitation without
changing ownership. Preview does not consume it. A lost token must be replaced.
Expiry is checked against wall-clock time after lock waits. Completed invitations
have no replay path, including after a vehicle is transferred back.

## Privacy and preservation

`set_service_visit_transfer_privacy(vehicle_id, visit_id, private)` is owner-only.
The default is shared. A choice applies to the whole visit and its operations;
normal saves retain it. Owners can still read their private content before transfer.

Acceptance archives private visits and operations in
`app_private.transfer_private_service_history`, with forced RLS and no client
grants or read RPC. Neither former owners nor recipients can retrieve that archive.
Public rows retain IDs, creation timestamps, dates, mileage, maintenance links and
one-time interval overrides. Notes, workshop names and costs are cleared, and
operation labels become `Private maintenance completion`. The service type stays
unchanged. Recipients may edit or delete these redacted rows through existing
Service History APIs; archived originals are never restored through those APIs.
The privacy choice remains set for future transfers.

Schedules, legacy completion baselines, mileage history and vehicle identifiers
stay attached to the same vehicle. Existing Service History derivation therefore
retains its ordering, override, month-end and leap-year behavior. Feature-flag
behavior remains unchanged. Vehicle-derived RLS immediately removes the former
owner's database access at commit; it cannot erase data previously downloaded.
Deleting the vehicle cascades its invitations and private archives.

## Concurrency and shop boundary

Transfer RPCs lock the vehicle before the invitation and recheck current ownership,
ownership epoch, status and expiry after waiting. Acceptance archives, redacts,
changes ownership, advances the epoch and consumes the token in one transaction.
Existing mileage and completion guards remain enabled. Stronger-isolation stale
transactions fail with `40001`; retry the complete transaction with a fresh
snapshot rather than assuming acceptance succeeded.

Schedule deletion now uses `delete_vehicle_maintenance_item(vehicle_id, item_id)`.
Direct authenticated DELETE is revoked: its previous RLS check could become stale
while waiting for a child-row lock during transfer. The new RPC locks and checks
the parent first, matching Service History APIs and avoiding a new child-first
delete trigger. Other schedule writes keep their existing parent/version guards.

No shop authorization exists or is created in this migration. Future shop grants
must bind to both vehicle ID and `ownership_epoch`, checking that epoch on every
read/write. Acceptance always advances the epoch, including transfers back to a
prior owner. Existing workshop labels carry no authorization.

## Migration prerequisites and local validation

- Apply existing migrations through `202610130001_vehicle_mileage_history.sql`
  first, with Firebase identity configuration and stable owner mappings intact.
- Run `202610130002_vehicle_ownership_transfer.sql` as the trusted migration role.
  Its SECURITY DEFINER functions require that role's existing ability to access
  forced-RLS tables (as in current identity and Service History migrations),
  private schema access and execution of `current_app_owner()`. Never grant that
  role to clients. SHA-256 and random UUID generation use PostgreSQL built-ins;
  no extension or new dependency is needed.
- Release the updated maintenance service with the migration because direct
  schedule deletion is revoked. Ensure PostgREST reloads the RPC schema cache.
  Task 6.4 adds `202610130003_vehicle_transfer_preview.sql` after that migration.
  It replaces only the preview function and adds the sender-only outcome status
  RPC. Install it before releasing the integrated UI; it reloads PostgREST's
  schema cache. Applied migrations must never be edited; remote application
  requires explicit authorization.
- Obtain the usual private backup and verify the migration ledger before any
  separately authorized remote application. Table lock timeout is five seconds;
  installation aborts rather than waiting indefinitely or changing live records.
- In a disposable local database, apply `supabase/tests/bootstrap.sql`, all
  migrations, then `supabase/tests/vehicle_ownership_transfer.sql`. Run
  `scripts/test-vehicle-transfer-concurrency.mjs` with the same guarded local test
  environment as the existing concurrency scripts. Never point it at live data.

Task 6.1 verification covers forced RLS/grants, hashes, constrained preview,
identity forgery/disablement, privacy, retained facts, rollback, replay, revocation,
decline, expiry and concurrent mutations under all three isolation levels.
SQL tests simulate claims; they do not test Firebase signatures or the hosted
PostgREST gateway. The original local verification performed no remote migration,
deployment, commit or push.

## Task 6.4 screen integration

Acceptance invalidates vehicle/mileage reads and maintenance calculations, then
refreshes Garage, Vehicle Details, alerts and notifications before navigating to
the accepted vehicle. Same-origin tabs receive a `BroadcastChannel` change signal
containing no token, identity or vehicle data. Open details/edit screens clear
their displayed records and drafts before revalidating; older responses cannot
restore them. Database RLS revokes the former owner's access at commit.

Authenticated sessions check a minimal RLS-protected vehicle ID/ownership-epoch
snapshot every five seconds while visible, and on focus/visibility return.
Consequently another device's open screen updates on its next successful check,
within five seconds when connected and visible. Network failures are retried;
offline copies already downloaded cannot be recalled. No Realtime publication
or cloud configuration change is required. Future shop grants must still check
the ownership epoch and require renewed authorization after transfer.

Sender links also survive a same-tab reload. A sender-only status RPC returns
only pending/accepted/declined/revoked/expired, never recipient identity or vehicle
content, and can report an accepted outcome after the sender loses vehicle access.
The sender panel checks this status on mount, focus and every five seconds. A
restored link is checked before copying/revoking; terminal outcomes clear storage.
Recipient preview/mutation failures retain tokens for retry except terminal
authorization failures or expiry. Tokens are sent only to the required application
RPCs; they never enter change broadcasts, persistent storage or HTTP link queries.

Focused regression coverage: `vehicle_transfer_preview.sql`, transfer component
and screen integration tests, session-storage recovery, ownership watcher,
same-origin signals, stale responses and open-form access revocation. Task 6.4
does not rerun the complete Task 6.1 audit or the application test suite.

## Database rollout checkpoint — 2026-10-14

**PASS for the authorized database rollout and read-only production postflight.**
Project `ttwlscydylnaogawmgce` on PostgreSQL 17.11 now records
`202610130002_vehicle_ownership_transfer.sql`, followed by
`202610130003_vehicle_transfer_preview.sql`. The pinned executor planned and
applied only those migrations, with no seeds or role changes. PostgREST's
reload-schema notification was committed after installation.

The existing private pre-Task-6 archive was reused. Its checksum, successful
isolated restore record, all six predecessors, schema/default grants and all
twelve source table fingerprints passed preflight with no changes since backup.
No new backup or repeat application/historical security audit was needed.

Postflight verified the two recorded migrations against approved SQL and exact
RPC function bodies, trusted owners, empty search paths, execute grants, forced
RLS, private archive isolation, invitation lifecycle constraints and ownership
epochs. All eleven existing application-table row fingerprints and six prior
ledger records were preserved. New invitation/archive tables were empty, and
existing epochs/privacy choices had only their intended default values.

**NOT VERIFIED:** authenticated production acceptance, former-owner access
revocation and private-record redaction. No accessible existing Firebase browser
sessions were available for the required pair of distinct authorized identities.
No credentials were created, claims simulated or authentication bypassed. No
disposable production records were created, so no test-data cleanup was needed.

The frontend was not deployed, and no commit or push occurred. A separate frontend
release must include the updated maintenance service: direct schedule DELETE is
now revoked and callers must use `delete_vehicle_maintenance_item`. Keep the
pre-migration backup private; any destructive recovery remains separately
authorized and must reconcile records created after its snapshot.
