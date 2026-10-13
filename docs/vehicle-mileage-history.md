# Vehicle mileage history (Task 5.2)

`vehicle_mileage_history` records each actual manual mileage change with a
database timestamp and `manual` source. Vehicle creation, unchanged values,
maintenance locking and Service History locking do not create entries. Existing
records are not backfilled. Deleting a vehicle cascades to its mileage history.

The vehicle update trigger appends within the same transaction, including changes
through the existing vehicle editor. History is read-only for clients, with forced
RLS resolving ownership through `current_app_owner()`. The trigger is a hardened,
non-callable SECURITY DEFINER function; no client supplies a history owner, source
or timestamp.

Task 5.1 uses the invoker `update_vehicle_mileage(uuid, integer)` RPC. It locks the
vehicle before checking for decreases against its current mileage, updates only
mileage and retains the existing maintenance and Service History guards. Existing
vehicle editor correction behavior remains governed by those guards. Rejected
updates and failed history inserts roll back together. Serialization failures are
returned to the caller; refresh and retry against current values. The read service
`loadVehicleMileageHistory(vehicleId)` loads all pages in stable newest-first order
using the immutable timestamp/ID cursor, so concurrent appends cannot shift page
boundaries. Concurrent requests share an in-flight read per vehicle and authenticated
owner, so an account switch cannot reuse another owner's response. Successful
quick mileage updates and vehicle editor saves invalidate older history and vehicle-list requests before emitting
refresh events. Older requests cannot clear the newer requests' deduplication state.
The history panel ignores superseded load and retry responses.

## Deployment prerequisites

- Apply `202610130001_vehicle_mileage_history.sql` only after all five existing
  migrations, including Firebase identity, maintenance consistency and Service
  History. Obtain separate authorization for remote application.
- The migration/function owner must have the established trusted PostgreSQL
  BYPASSRLS or superuser capability to append through forced history RLS. Clients
  retain only SELECT access to history. Keep the trigger's EXECUTE revoked.
- Apply the migration before publishing the updated Task 5.1 service; it requires
  the new RPC. Ensure the Supabase REST schema cache exposes the new table/function.
- Installation takes a vehicle writer lock with a five-second lock timeout.
  A timeout aborts the transaction; retry during a suitable deployment window.

Run `supabase/tests/vehicle_mileage_history.sql` and
`scripts/test-vehicle-mileage-concurrency.mjs` only in the disposable local/CI
database, never on application records. These test database authorization with
simulated claims, not Firebase token signature validation. CI applies the migration
and runs both tests after the existing database checks.

## Database rollout checkpoint (2026-10-13)

Migration `202610130001` was confirmed pending, then applied to linked Supabase
project `ttwlscydylnaogawmgce` using the reviewed transaction, trusted `postgres`
owner and five-second lock timeout. The executor planned only this migration,
without seeds or role changes. Its SHA-256 was
`2ee2c661fe7cc657d1d805a65ee7823ca807bbf307cfb3defd0d3043ee2b9641`.

The five predecessor ledger records and their SQL-equivalence evidence were
reconfirmed against the verified private backup. Backup SHA-256 was
`c0e2e0f38a9c15b8782f29325286eb45d0671cdab960e801fb7997b45e2aa991`.
Captured application schema matched before execution; see
[recovery findings and limitations](task5-backup-recovery.md).

Database postflight passed: ledger version, table/constraints/indexes, trusted
object owners, function definitions, forced RLS, policies and grants. Existing
application schema and ten application-table row fingerprints were preserved;
the new history table was empty. PostgREST schema-cache reload was committed,
and anonymous requests recognized the table/RPC but were denied access.

Authenticated live RPC testing passed after normal Firebase Google sign-in through
the existing development workflow. Disposable fictional vehicles verified a mileage
increase and its timestamped manual history entry, an unchanged-value no-op,
rejection of a decrease, and cross-owner vehicle/history invisibility and RPC denial.
Only the marked test vehicles and temporary fixture owner were cleaned up. The
post-cleanup database checks passed again, with all existing application-table
fingerprints preserved and zero remaining history rows. No frontend deployment
was performed.
