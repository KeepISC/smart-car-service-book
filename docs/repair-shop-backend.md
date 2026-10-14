# Repair shop backend foundation

## Current UI integration

`/shops` lets active shop admins create and cancel customer invitation links and
navigate to `/workshop`. `/shop-connections` preserves the invitation fragment
through sign-in, previews the shop and requires explicit vehicle/record-permission
selection. Vehicle details provide shop discovery, request approval/revocation and
owner-controlled sharing. Owner-initiated requests use shop acknowledgment followed
by separate owner approval. `/workshop` supports admins and mechanics with approved
customer vehicles, shared history, workshop recording and reminders. `/platform`
supports platform shop registration, profiles, subscriptions, suspension, admin
assignment and audit history. Both desktop and mobile navigation expose these
routes; platform navigation uses a capability check, while RPCs enforce authority.
Shop self-registration and ordinary staff management remain service/RPC capabilities
without dedicated UI forms.

## Identity and staff

`202610140001_repair_shops.sql` adds private shop profiles, staff memberships,
vehicle authorizations and service-record provenance. All four tables use forced
RLS and have no client grants or policies. Only narrowly checked RPCs expose them.
Existing vehicle, schedule and Service History owner policies remain unchanged.

Shop access requires the existing recognized Firebase identity, enabled identity
mapping and stable application UUID through `current_app_owner()`. Legacy Supabase
sessions cannot use shop RPCs. Firebase JWT `role` remains `authenticated`; shop
roles are database memberships. Personal ownership and shop membership coexist,
and a user can belong to multiple shops. No identity is inferred from email.

`create_repair_shop(name)` creates the profile and its creator's admin membership
atomically. Other already provisioned users call
`request_repair_shop_membership(shop_id)` for themselves. This grants no access.
An admin uses `list_repair_shop_staff` and `set_repair_shop_staff` to approve an
existing self-request as `admin` or `mechanic`, change its role, or remove it with
a null role. The target UUID selects that membership, never the caller's identity.
Mechanics cannot manage staff or customer authorizations. A shop must retain an
active administrator. Removal does not delete service provenance. A new
self-request after removal still needs admin approval.

Staff membership uses self-requests without invitations, email searches or a user
directory. Known shop UUIDs are used for explicit vehicle requests. Task 7.2 adds
customer connection links as described below; shop discovery UI and profile
editing remain outside this foundation.

## Owner approval and permissions

| Capability                                                              | Vehicle owner           | Shop admin                | Mechanic                  |
| ----------------------------------------------------------------------- | ----------------------- | ------------------------- | ------------------------- |
| Initiate a known vehicle/shop request                                   | Yes                     | Yes                       | No                        |
| Approve customer access and record creation                             | Yes                     | No                        | No                        |
| Revoke customer access                                                  | Yes                     | Yes, for own shop         | No                        |
| Read approved vehicle/completion projection                             | Through owner APIs      | Yes                       | Yes                       |
| Create workshop records                                                 | Through owner APIs      | With owner write approval | With owner write approval |
| Manage shop staff                                                       | Only if also shop admin | Yes                       | No                        |
| Transfer/delete/edit customer vehicles or edit/delete existing services | Through owner APIs      | No shop permission        | No shop permission        |

`request_vehicle_shop_authorization(vehicle_id, shop_id)` creates a pending
request regardless of its initiator. Repeating it returns the current open request
without resetting an approval. Only the current vehicle owner can separately call
`approve_vehicle_shop_authorization(vehicle_id, authorization_id, can_create_records)`.
View access is always explicit; creation is a separate owner-selected boolean.
Approval cannot be replayed to upgrade view-only permission. Revoke and request
a new approval to change permissions. Task 7.2 adds pending decline, cancellation
and expiry; active access still uses revocation. No shop request returns vehicle
contents or owner identity.

Approvals bind to the vehicle's current `ownership_epoch` and approving owner.
Every customer read/create checks both, current active staff and approval status.
Transfers invalidate grants and pending requests without modifying the transfer
RPC. Transferring back never restores an old grant. A new owner must approve a
new request. `list_vehicle_shop_authorizations` is owner-only;
`list_repair_shop_authorizations` is active-staff-only and lists current-epoch
metadata, not customer content. Lists are discovery, not cached capabilities:
customer access always revalidates independently.

`get_repair_shop_vehicle` returns make/model/year/engine/type/mileage and schedule
intervals/baselines plus dated completion facts and existing one-time overrides.
By default it excludes owner UUID/email, plate, VIN, costs, notes, workshop details,
operation labels and custom schedule names. Task 7.9A below adds explicit owner
sharing for selected non-private records and schedule names. Private completions
retain only their calculation facts. Archived
transfer-private originals have no shop read path.

## Append-only records and concurrency

`create_repair_shop_service_visit(shop_id, vehicle_id, payload)` accepts only
service date, mileage, new notes/costs and 1–50 named operations, optionally linked
to schedules of that vehicle. It derives workshop identity from the shop and
records author/shop/authorization provenance in the same transaction. It accepts
no owner, existing visit ID, privacy flag, service type, workshop name or interval
override. Invalid payloads, precision, future dates, above-vehicle mileage,
cross-vehicle links and duplicate schedule links roll back the entire operation.
Owners must update mileage through existing APIs first. Creation retains existing
completion/mileage guards and never changes permanent intervals or legacy
baselines. Owners can subsequently manage the resulting history through their
existing APIs; shop editing/deletion is not implemented. Frontend service creation
preserves the existing Service History feature flag.

Customer operations lock vehicle first, then shop, then referenced schedules,
then visit/operation rows. Mutations affecting vehicle permission create a vehicle
row version, matching existing Service History concurrency guards. Staff changes
create a shop row version. Customer reads and writes hold a shop SHARE lock;
reads also hold a vehicle SHARE lock. Revocation, removal and transfer either
wait for already authorized work to finish, or complete first and make the work
fail. Stale REPEATABLE READ/SERIALIZABLE snapshots fail with `40001`. Retry the
entire transaction with fresh authorization checks. Helpers are private and have
no client execute grants; all definer functions use an empty search path.
Already downloaded data cannot be recalled after revocation.

## Task 7.7 workshop maintenance UI

The CRM vehicle details offer **Record Maintenance** to admins and mechanics
only when the current authorization permits record creation and the existing
Service History feature flag is enabled. The form uses the existing append-only
service API, shared field validation and server authorization checks. It supports
1–50 named operations, optional schedule links, notes and visit/operation costs.
Mileage cannot exceed the current vehicle odometer; the owner must update it first.
The shop has no record edit/delete actions or interval overrides.

Successful saves refresh the CRM completion history and maintenance status through
the existing maintenance-change event, also used by the notification center.
Access denial removes the open vehicle data; failed saves are not retried
automatically. An uncertain network result requires checking history before retry.

The default projection omits operation names, schedule names, notes, costs and
workshop provenance, including for newly created records. With Task 7.9A and the
current UI integration, the CRM displays these details only when the owner has
explicitly shared them. Private and unselected visits retain their completion-facts
display. No cross-session push notification capability is implemented.

## Task 7.8 persistent in-app reminders

`202610140004_shop_maintenance_reminders.sql` requires all migrations through
`202610140003_platform_shop_administration.sql`, PostgreSQL 17 and the same trusted
migration/definer access to forced-RLS tables. No remote migration is performed.

Active shop admins and mechanics can send a structured reminder for an approved
vehicle's due or overdue schedule, including view-only approvals. Record-creation
permission is separate. There is no free-text message or owner-selected recipient.
The RPC derives the sender, owner and ownership epoch and rechecks current shop
membership, subscription, suspension and approval. The CRM reuses its existing
maintenance summary; the server independently enforces the same due-soon limits
(1,000 km or 30 days), latest completion/baseline rules, month-end dates and one-time
overrides. Server date checks use UTC. Focused parity tests cover both calculations.

The private reminder table has forced RLS and no client table grants. Only narrow
send/list/state RPCs are exposed to authenticated identities. The recipient inbox
includes shop name, current vehicle/operation labels, send time and read state;
it never exposes sender or owner UUIDs. Shops cannot read recipient inboxes.
Recipients can mark reminders read or dismiss them. Revoking a connection or a
shop's access blocks new sends but preserves current-owner inbox messages.
Vehicle deletion or schedule deletion removes dependent reminders.

Limits use rolling wall-clock windows: one reminder per shop/vehicle/operation
per seven days, three per vehicle per 24 hours across all shops, and fifty per shop
per 24 hours across all vehicles. Read/dismiss actions and ownership transfers do
not reset limits. Vehicle row updates then exclusive shop row updates serialize
sends and quota decisions; stale stronger-isolation transactions fail with `40001`
and are not retried automatically. Subscription validity is checked again after
schedule-lock waits. Recipient reads/state changes hold vehicle locks and require
both the current owner and matching epoch. Transfer, including transfer back,
never restores or forwards previous-epoch reminders.

The notification center loads the latest 100 non-dismissed reminders on mount,
navigation, focus and visibility resumption. Its badge counts unread reminders
alongside existing maintenance alerts. Existing ownership-change signals clear
cached reminder data and reject stale responses. Dismiss older reminders to
expose earlier messages. No automatic sending, delivery/read receipts for shops,
retention cleanup, email, SMS or live cross-session push is implemented. A current
session can retain already-downloaded data until its next refresh or ownership
signal; the server always revalidates subsequent reads and mutations.

Focused checks (fresh disposable local PostgreSQL only):

- Run `supabase/tests/shop_maintenance_reminders.sql` after bootstrap and all
  migrations in order.
- Run `scripts/test-shop-reminder-concurrency.mjs` with the guarded disposable
  environment documented below. It exercises duplicate sends, revocation, staff
  removal, suspension, transfer/read races, expiry after a lock wait and due-status
  parity, without repeating earlier audits.
- Run `src/services/shopReminders.test.ts`, `src/components/ShopReminders.test.tsx`,
  `src/components/NotificationCenter.test.tsx` and `src/pages/ShopCrm.test.tsx`.

## Task 7.9A backend integration

Apply `202610140005_shop_discovery_administration.sql` after all migrations through
`202610140004_shop_maintenance_reminders.sql`, then
`202610140006_shop_review_data_sharing.sql`. Both require the existing PostgreSQL 17
trusted migration/definer access to forced-RLS tables. No remote application is
performed. No UI, identity provisioning, billing or uploads are changed.

`platform_search_repair_shops(search,status,offset,limit)` returns
`{items,total,offset,limit}` with literal case-insensitive name/ID search, effective
status filtering and deterministic ID ordering. Count/page use one snapshot; an
out-of-range page still returns the total. The existing array-returning
`platform_list_repair_shops` delegates to it for compatibility. Pages allow 1–200
rows. `platform_list_shop_administrators` lists active admin Firebase UIDs and
whether their provisioned identity is enabled, including disabled identities that
need revocation. `platform_find_provisioned_users` performs a bounded UID search
(minimum three characters, maximum fifty results per page), returning only enabled,
already-provisioned Firebase UIDs and pagination metadata. The identity store has
no searchable email/display-name directory. Assignment continues through the
existing audited platform assignment RPC; no actor or owner UUID is selected.

`search_available_repair_shops(vehicle,search,offset,limit)` is current-owner-only.
It searches active, unsuspended shops within their subscription window, with an
enabled active admin and available connection capacity (or an existing approval
for this vehicle). The directory exposes only ID/name and business address, phone
and website. Pages allow 1–100 rows and count/page share a snapshot. Discovery is
not a capability: requests and approvals revalidate access/capacity independently.

`review_owner_shop_request(vehicle,authorization,'accepted'|'declined')` is
shop-admin-only and accepts only unexpired current-epoch owner-initiated pending
requests. Acceptance records `shop_accepted_at` and leaves the request pending;
decline reuses the existing resolution API. Both authorization lists expose the
acceptance timestamp. Owner approval remains a separate mandatory action before
any customer data becomes available. Existing direct owner-approval and invitation
flows remain compatible: shop acknowledgment is not a new prerequisite for those
already explicit owner approvals.

`set_vehicle_shop_data_sharing(vehicle,authorization,customer_reference,
share_operation_names,shared_visit_ids)` is current-owner-only for a current-epoch
approved authorization. It atomically replaces the explicit choices: an optional
1–80-character customer reference, schedule-name sharing and up to 1,000 selected
non-private visits. Default sharing is off. An opaque authorization-derived
customer reference is returned when the owner supplies none. No email, owner ID,
plate or VIN is exposed. Sharing can be withdrawn even while the shop is disabled.
Shop staff and platform admins have no shortcut to authorize sharing.

The existing `get_repair_shop_vehicle` RPC retains its sanitizer and enriches only
authorized fields. Schedule names require the name flag. Only explicitly selected
visits that remain non-private include notes, total cost, operation names/costs,
service type and workshop label. Canonical workshop provenance includes shop ID,
shop name and recording timestamp only when its source authorization matches the
current owner/epoch; sender/author identities are never returned. Private visits
and unselected visits remain calculation-facts-only. Future visits are not shared
automatically. A later private flag suppresses details immediately. Revocation or
transfer denies reads, and a new authorization never inherits prior sharing.
Archived transfer-private records retain no shop read path.

New sharing rows have forced RLS and no client table grants. Existing inaccessible
delegates enforce the original access rules. Reads hold the existing vehicle/shop
locks; sharing replacement and review update the vehicle row version before any
other locks. Stale stronger-isolation requests fail with `40001` without automatic
retry. New sharing is explicit per authorization, and no existing record or
approval is rewritten by these migrations.

Focused checks: `supabase/tests/shop_backend_integration.sql`,
`scripts/test-shop-backend-integration-concurrency.mjs` on the guarded disposable
local database, and `src/services/shopBackendIntegration.test.ts` plus the existing
platform, repair-shop and connection service tests. Do not rerun prior Task 7
audits. UI integration is described above; hosted PostgREST/Firebase verification
remains separate work.

## Migration prerequisites and focused verification

Apply only after all migrations through
`202610130003_vehicle_transfer_preview.sql`, using PostgreSQL 17 and the configured
Firebase integration, stable owner mappings and trusted migration role. The
definer must retain private-schema access and the trusted ability to access
forced-RLS tables, as required by existing RPCs. Never grant that role or
`BYPASSRLS` to application clients or the restricted provisioning login. Do not
alter applied migrations or change Firebase claims/provisioning. This migration
adds no new client table grants and reloads the PostgREST schema cache at commit.
Remote application, backup/prerequisite checks and deployment require separate
authorization; Task 7.1 performs none of them.

Focused local checks:

- `npm.cmd test -- src/services/repairShops.test.ts`
- In a fresh disposable PostgreSQL database, run `supabase/tests/bootstrap.sql`,
  all migrations in order, then `supabase/tests/repair_shops.sql` with
  `ON_ERROR_STOP=1`. Never run the fixtures on hosted databases.
- Set `SCSB_DISPOSABLE_DATABASE_TEST=true`, `PGHOST=localhost`, `PGPORT=5432`,
  `PGUSER=postgres`, `PGDATABASE=maintenance_test` and a fictional local password;
  run `node scripts/test-repair-shop-concurrency.mjs` on that disposable database.

SQL tests exercise real RPCs with fictional claims, forced RLS, restrictive
grants, dual roles, pending/view-only/write access, private projection, atomic
creation, removal and transfer epochs. The concurrency runner tests both orderings
of revocation/removal/transfer versus record creation, stale customer reads,
and concurrent admin demotions across all three isolation levels. Service tests
check actor-free request contracts, explicit approval, feature flags and failure
propagation. Local validation also tests the new RPCs under a non-superuser trusted
definer and hostile default client grants. These tests do not verify live Firebase
signatures or hosted PostgREST; no full application suite or historical audit is
needed for this foundation.

## Task 7.2 connection lifecycle

`202610140002_repair_shop_connections.sql` requires **Task 7.1's
`202610140001_repair_shops.sql` first**, plus its existing Firebase and ownership
transfer prerequisites. Apply with the same trusted migration/definer role; new
and replaced RPCs require the same private-schema and forced-RLS access. It
preserves all existing approved authorizations and grants, adds no client table
access, and reloads the PostgREST schema cache. No remote migration was performed.

Owner-initiated connections continue to use `request_vehicle_shop_authorization`
and the separate `approve_vehicle_shop_authorization` RPC. Pending requests now
expire after one day. Pre-existing pending rows use their original creation date
plus one day, without extending old requests. Approval checks wall-clock expiry
after obtaining the vehicle row-version boundary. Lists report effective expiry
without needing a scheduler; repeating a request closes an expired pending row
and creates a new ID. Approved access does not expire with its original request.

`resolve_vehicle_shop_request(vehicle_id, authorization_id, outcome)` accepts
`declined`, `cancelled` or `expired` for current-epoch pending requests only.
The initiating side may cancel, and the receiving side may decline: owner versus
shop admin, determined by the stored initiation direction. Either side can mark
a request expired after its deadline. Mechanics and unrelated identities cannot
resolve requests. Terminal requests cannot be approved or replayed; existing
`revoke_vehicle_shop_authorization` remains the active-access revocation API.

An active shop admin calls `create_repair_shop_connection_invitation(shop_id,
expires_at)` without any customer or vehicle ID. It returns an invitation UUID,
token **once**, and expiry (default one day, maximum seven days). Each link is
single use for one customer vehicle. Two random UUIDs supply 244 random bits;
only a unique SHA-256 hash is stored in a new private forced-RLS table with no
client grants. Treat tokens as bearer capabilities: deliver privately, never log,
send to analytics, or store in persistent browser storage. The service link helper
places the token in `/shop-connections#shop-connection=...`, never the HTTP query.
The receiving route/UI is implemented as described above.

`preview_repair_shop_connection_invitation(token)` requires a recognized Firebase
identity and exposes only invitation ID/expiry and shop ID/name. It creates no
request and reveals no customer, vehicle, owner, staff or authorization data.
`accept_repair_shop_connection_invitation(token, vehicle_id, can_create_records)`
requires the caller to own the selected vehicle **at acceptance** and explicitly
choose record permission. It reuses the request and owner-approval RPCs, then
consumes the token in the same transaction. Newly created requests are marked
shop-initiated; existing pending requests retain their initiation direction.
An already approved connection cannot be silently upgraded: revoke and renew it.
Failures leave both token and permissions unchanged.

`decline_repair_shop_connection_invitation(token)` lets an authenticated bearer
consume a link without selecting or revealing a vehicle. Shop admins can cancel
pending links by shop/invitation ID. Admin-only invitation lists expose only
ID/expiry/effective status, never token hashes or accepted customer information.
Expired, consumed, cancelled and declined tokens have no replay path. Links are
bound to the issuing admin's staff generation: removal or demotion invalidates
them permanently, even after reinstatement. A disabled issuer mapping also denies
use. Active approved shop authorizations remain governed by current membership
and vehicle epochs, independently of the original issuer.

Acceptance locks vehicle, then shop, then invitation; generic link operations
lock shop then invitation and never subsequently acquire vehicle locks. Staff
changes use the existing shop row-version boundary. Expiry is checked after lock
waits and again before acceptance commits its token consumption. Concurrent
acceptance can succeed only once, including when selecting different vehicles.
Stale stronger-isolation transactions fail with `40001`; restart the entire
transaction and revalidate rather than assuming success. Accepted grants use the
current ownership epoch; transfer invalidates them, including transfer back.
Unused generic links have no vehicle binding: only the current owner can select
and approve a vehicle when using one.

Focused Task 7.2 verification (do not rerun the Task 7.1 audit):

- `npm.cmd test -- src/services/repairShopConnections.test.ts`
- On a fresh disposable PostgreSQL database with bootstrap and migrations applied
  in order, run `supabase/tests/repair_shop_connections.sql` with `ON_ERROR_STOP=1`.
- Using the same guarded disposable environment documented above, run
  `node scripts/test-shop-connection-concurrency.mjs`.

These checks cover explicit approval, preview privacy, hashing/grants, request
resolution, expiry, atomic rollback, issuer generations, single use, competing
vehicle acceptance and transfer/cancel/removal races. They do not apply remote
migrations or verify hosted Firebase signatures/PostgREST.

## Task 7.4 platform administration

`202610140003_platform_shop_administration.sql` requires Task 7.1 and Task 7.2,
through **`202610140002_repair_shop_connections.sql`**, and their existing Firebase,
ownership and PostgreSQL 17 prerequisites. Use the same trusted migration/definer
owner, with private-schema access and the existing forced-RLS capability. The
migration moves established RPC implementations into private delegates, revokes
their client execute grants and preserves public signatures through checked
wrappers. All new private helpers are inaccessible to `anon`/`authenticated`.
No applied migration is edited and no remote change is performed by this task.

Platform administrators are active rows in `app_private.platform_administrators`,
associated with the existing Firebase UID → stable application UUID mapping.
Every administrative mutation locks and checks this row with the recognized,
enabled Firebase identity. Shop admin/mechanic membership and JWT flags confer no
platform authority. There is no public platform-role registration or grant RPC.
`is_platform_administrator()` is UI capability discovery only; it never substitutes
for server authorization. Platform powers expose shop configuration and private
administration audit records, not customer vehicle/history data. Ordinary
customer RPCs still require active shop membership and owner approval.

Platform service APIs support creating/updating profiles, setting suspension,
setting a manually managed subscription and assigning/revoking shop admins using
an independently verified existing Firebase UID. Platform administrators need no
shop membership and can recover a suspended shop with no active shop admin.
They may remove the last shop admin; the existing shop-admin last-admin guard
remains enforced for ordinary staff management. Removing/reassigning admins
continues to advance staff generations and invalidate old issued links.
Disabled mapped identities can be revoked but cannot be assigned new authority.

Profiles store the existing canonical `name` as business name, plus an opaque
logo reference, six-digit hex colors, contact email/phone/address and an HTTPS
website. Profile updates replace only those fields. Logo references are asset
identifiers, never executable markup or arbitrary URLs; resolution/rendering and
uploads are outside this backend. Contact fields are business metadata, not
customer contacts. Platform shop/audit lists use bounded pagination.

Subscriptions store a manually chosen plan code, `pending`/`active`/`disabled`
status, finite start/end instants and optional nonnegative limits. Effective access
requires **not suspended**, active subscription, start ≤ current time < end.
Administrative suspension is independent of subscription status: renewal cannot
unsuspend a shop, and reactivation cannot extend an expired subscription.
Zero limits prohibit new allocation; null means uncapped. Enforced limits are
active staff, current-epoch owner-approved vehicle connections and retained shop
service records created in the current UTC calendar month. Monthly creation uses
immutable wall-clock provenance; historical rows retain their original creation
timestamps. Owner deletion of a visit releases its retained-record capacity.
Lowering limits preserves existing staff/approvals/history and blocks new
allocation above the cap. There is no billing, automatic renewal or plan catalog.

**Rollout prerequisite:** existing and newly created shops start with pending
subscriptions. No paid access or expiry date is inferred. A trusted operator must
bootstrap a platform admin and that admin must explicitly configure subscriptions
before shop work can resume. Existing self-created shop profiles/admin memberships
remain possible but cannot activate their own subscription or platform role.
Nothing alters personal vehicle RLS, mileage, schedules or existing service rows.
Suspension/expiry temporarily denies shop access; renewal restores only still-valid
memberships and same-epoch approvals. Transfers during downtime still invalidate
old approvals. Expiring, consumed and issuer-invalidated links remain invalid.

### Connection and concurrency adjustments

| Existing path                                                                 | Task 7.4 adjustment                                                                                                                                                 |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Staff/customer reads, shop requests, invitation creation/cancellation/listing | Shared membership lock now also enforces suspension and subscription window.                                                                                        |
| Owner-initiated request                                                       | Public wrapper checks entitlements after locking the vehicle.                                                                                                       |
| Owner approval, including invitation acceptance                               | Checked wrapper serializes connection capacity and preserves owner/epoch/expiry checks.                                                                             |
| Recipient preview/accept/decline                                              | Private token helper checks entitlements after token-lock waits; acquires an exclusive shop version before the invitation to avoid lock upgrades during acceptance. |
| Staff self-request and approval                                               | Checked wrappers enforce availability; activation serializes staff capacity.                                                                                        |
| Workshop record creation                                                      | Checked wrapper serializes monthly capacity and rechecks subscription expiry after schedule/record work.                                                            |
| Shop discovery                                                                | Lists available shops only; platform lists include effective disabled/expired status.                                                                               |
| Owner request resolution/revocation and authorization listing                 | Remain available while disabled so owners can inspect and remove access; these never grant new shop access.                                                         |

Customer mutations retain vehicle → shop → invitation/schedules → record order.
Capacity allocation takes an exclusive shop row version, including different
vehicles. Platform changes lock platform membership then shop and never acquire
vehicle locks. Reads hold a shop SHARE lock, so suspension either waits for an
already authorized operation or commits first and denies it. Stronger stale
snapshots fail with `40001`; callers restart the whole transaction. Subscription
checks use wall-clock time after waits, with a final check for record creation.
Platform-role revocation similarly serializes against administrative mutations.
Already downloaded records cannot be recalled.

### Administrative audit and first-admin bootstrap

`app_private.platform_shop_audit` uses forced RLS with no client table grants.
Each platform create/profile/subscription/suspension/staff-admin change writes
server-derived actor UUID, database executor, timestamp, reason and before/after
configuration in the same transaction. Failed writes or missing reasons roll
back both configuration and audit. No API can edit/delete audit rows. Audit data
is platform-only and contains no invitation tokens or customer history. Trusted
operator grants/revocations of platform authority are also audited, with a null
application actor and their database executor. Privileged manual DML is not an
application audit path; use the trusted helper instead of editing rows directly.

First-admin bootstrap is an explicitly authorized operator action, not performed
by this implementation:

1. Have the intended administrator sign in through existing Firebase and trusted
   provisioning. Do not create a new mapping, infer ownership from email or set a
   privileged Firebase JWT `role`.
2. Independently verify the selected Firebase UID with Firebase Admin using the
   configured project: account enabled, verified email, and existing stable owner
   mapping. Record the operator approval/reference privately. Never paste tokens,
   service-account keys or database URLs into project files or chat.
3. Through the existing trusted migration/operator PostgreSQL connection with
   verified TLS, use the private helper with bound parameters. It requires an
   existing enabled mapping and is not executable by browser/service client roles:

   ```sql
   begin;
   prepare bootstrap_platform_admin(text, text) as
     select app_private.set_platform_administrator($1, true, $2);
   execute bootstrap_platform_admin(
     'independently-verified-existing-firebase-uid',
     'Privately recorded operator approval reference'
   );
   deallocate bootstrap_platform_admin;
   commit;
   ```

4. Verify the helper's audited result privately, then use an actual Firebase
   session to call `is_platform_administrator()` and a platform metadata RPC.
   Configure explicit subscriptions/admin memberships for reviewed shops. No
   public RPC can grant platform authority. The same trusted helper with `false`
   revokes it; keep operator recovery available outside application accounts.

Focused Task 7.4 checks, without repeating Task 7.1/7.2 audits:

- `npm.cmd test -- src/services/platformAdministration.test.ts`
- On fresh disposable PostgreSQL with bootstrap and all migrations in order,
  run only `supabase/tests/platform_shop_administration.sql` with `ON_ERROR_STOP=1`.
- Under the existing guarded local test environment, run
  `node scripts/test-platform-shop-concurrency.mjs`.

Tests cover independent platform authority, protected RPC availability, audit
atomicity, admin recovery, quotas, owner/history preservation, connection epochs,
subscription/suspension/role races and expiry after lock waits. The local runner
also uses non-superuser trusted definers and hostile default client grants. Live
Firebase signatures, hosted PostgREST, bootstrap and subscription activation are
not verified or performed by these local tests.

## Consolidated Task 7 verification — 2026-10-14

Local verification PASS after focused fixes. The full application suite ran once:
484/485 tests passed; the remaining notification test assumed a single loading
status before shop reminders were added. Its assertion now targets maintenance
loading. Focused tests after fixes passed 23/23, including two new regressions.
The full suite was not repeated.

- PASS: full lint, TypeScript/production build and publication-candidate secret
  scan. Changed supported files passed Prettier; SQL has no configured formatter.
  Focused lint and TypeScript checks also passed after UI fixes. The build retains
  its non-failing bundle-size warning.
- PASS: all five Task 7 SQL security suites and all five concurrency suites, once
  at their corresponding migration stages, on disposable PostgreSQL 17.10 with
  hostile default client grants and trusted non-superuser definers.
- PASS: migrations `202610140001`–`202610140006` applied sequentially and preserved
  seeded existing owner mappings, vehicle, schedule, private service history,
  operations and mileage rows. No Task 1–6 database suites were run.
- PASS: headless Edge smoke checks at 320, 375 and 1280 pixels for navigation,
  invitations, CRM history/recording, platform forms, owner sharing and reminders,
  with fictional mocked services, no horizontal page overflow and no browser
  runtime errors. This is UI verification, not hosted authentication integration.

Confirmed fixes: shop selection/expiry controls are locked during invitation
actions so a late link cannot appear under another shop; sharing-history failures
show retry instead of an empty-history message and block saving until loaded.
Regression tests cover both. No migration or backend behavior was changed.

Files edited during final verification: `src/pages/ShopInvitations.tsx` and its
test, `src/components/RepairShopConnections.tsx` and its test,
`src/components/MaintenanceNotifications.regression.test.tsx`, the projection
comment in `src/components/ShopVehicleHistory.tsx`, and this guide. Disposable
database/browser runners and fictional UI fixtures remain ignored under
`.tmp/task7-final-*`.

Rollout still requires PostgreSQL 17, all migrations through
`202610130003_vehicle_transfer_preview.sql`, configured Firebase integration and
stable owner mappings, plus a trusted migration/definer role with private-schema
and forced-RLS access. Apply Task 7 migrations in numeric order. Verify remote
target, migration checksums and backups under separate authorization. Existing
and new shops start with pending subscriptions: independently verify and bootstrap
the first platform admin through the documented operator procedure, then explicitly
configure subscriptions and memberships. Service History must be enabled for
workshop recording.

Hosted Firebase signatures/PostgREST, remote migration compatibility, operator
bootstrap and production subscription activation remain NOT VERIFIED. No remote
migration, bootstrap, commit, push or deployment was performed.

## Controlled remote rollout — 2026-10-14

Supabase project `ttwlscydylnaogawmgce` now records all fourteen migrations through
`202610140006`. The authorized resume applied only `202610140002`–`202610140006`
in order; the previously committed `202610140001` was verified and not reapplied.
The corrected postflight helper preserves the staff-version trigger's deliberate
`SECURITY INVOKER` mode and checks it against the isolated rehearsal.

PASS: resume preflight, private backup checksum/availability and recent isolated
restore evidence, transactional and committed postflight after each migration,
exact final ledger/source SQL, RPC permissions, forced RLS, schema/default grants
and existing application data/ownership fingerprints. Final ownership and
subscription definitions match the isolated runtime checks for access isolation,
subscription windows/suspension and capacity enforcement. These runtime checks
used fictional data in the isolated restore; no production fixtures were created.
The final PostgREST schema-cache reload notification committed successfully.

No platform administrators were bootstrapped and no shops were activated; all new
shop/platform/reminder tables remain empty. No Git commit, push or application
deployment occurred. Hosted Firebase/PostgREST authenticated-session behavior
remains NOT VERIFIED. The full application suite and historical audits were not
repeated. Ignored resume checkpoints are under `.tmp/task7-rollout-resume-*`;
the private backup remains outside the repository.

### First platform administrator bootstrap — 2026-10-14

After explicit operator approval for one independently selected UID, Firebase
Admin revalidated the enabled account, verified email and existing provisioned
owner mapping. The trusted private bootstrap helper committed exactly one active
platform administrator and its corresponding operator audit record. Transactional
and committed postflight passed; existing audit records and shops were preserved.
Firebase accounts and claims were not changed. The approval reference and account
details are recorded privately outside the repository.

Authenticated platform RPC verification remains NOT VERIFIED: the existing
browser debugging endpoint was unavailable. Verification stopped without retrying
the grant or changing privileges. A matching signed-in application session must
be made accessible before the read-only platform capability, shop metadata and
audit RPC checks can finish. No shops were activated, no additional administrators
were created, and no commit, push or deployment occurred. Ignored operational
scripts/checkpoints are under `.tmp/task7-bootstrap-*`.

### Hosted authenticated integration — 2026-10-14

Using the existing local frontend/provisioning configuration and real signed-in
sessions against hosted Firebase and Supabase, the following checks passed:

- The approved administrator UID, recognized stable owner mapping and idempotent
  existing-user provisioning; platform role detection and dashboard rendering.
- Platform shop listing/search, audit listing with the matching bootstrap record,
  and lookup of the already provisioned administrator UID.
- Authenticated shop listing, owner reminder inbox, owned vehicle listing/detail,
  vehicle authorization listing and available-shop discovery.
- An existing provisioned ordinary user received `42501` from all five platform
  read RPCs (listing, search, shop administrators, audit and provisioned-user
  lookup); the platform dashboard denied access. An existing foreign vehicle was
  hidden by RLS. Hosted Service History/operation reads also succeeded.

Remaining NOT VERIFIED: successful shop-administrator listing and customer-shop
vehicle reads, because no existing shops/eligible connections were available.
The owner Service History service call was blocked by the disabled UI feature
flag; a focused flag diagnostic confirmed this rollout gate, while the underlying
hosted history read passed. The flag was preserved. No product integration defect
was confirmed and no application fix was made.

No shops, subscriptions, privileges, Firebase accounts/claims or customer records
were changed. No migrations, full suites or historical audits were repeated, and
no commit, push or deployment occurred. Operational runners and sanitized results
remain ignored under `.tmp/task7-authenticated-*`, `.tmp/task7-ordinary-user-*`
and `.tmp/task7-history-read-*`; browser sessions remain in an ignored local
profile. Both local servers were started for this verification.
