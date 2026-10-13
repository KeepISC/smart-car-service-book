# Task 3 pre-deployment verification — 12 October 2026

Current status: this is the retained pre-deployment record. The migration was subsequently applied under explicit authorization and real Firebase/PostgREST CRUD acceptance passed with complete fictional-record cleanup and preservation. See the [13 October final verification](task3-final-verification.md); do not treat the historical NO-GO below as the current publication verdict or reapply the migration.

**Recommendation: NO-GO for production migration deployment at present.** PostgreSQL 17 testing, scoped production preflight and legacy-client compatibility checks pass. A separate bridge is not required solely to preserve ordinary maintenance edits: the migration retains narrow legacy column grants and guards conflicting completion writes. The remaining gates are real Firebase/Supabase browser/API acceptance in a disposable environment, exact PostgreSQL 17.11 execution, and backup/recovery readiness. Follow the [coordinated rollout plan](task3-rollout-plan.md); no deployment or remote migration was performed.

## PostgreSQL 17 compatibility

Executed against isolated **PostgreSQL 17.10**, using `embedded-postgres@17.10.0-beta.17` installed only under ignored `.tmp/postgres17-tools`. The available package versions did not include 17.11; **exact 17.11 execution is NOT VERIFIED**. Production was independently queried and reports **17.11**. This is actual PostgreSQL 17 execution, not a compatibility inference from the earlier PostgreSQL 18 audit.

All five migrations applied in chronological order, ending with `202610120002_service_history.sql`. All ten SQL files under `supabase/tests` ran at their appropriate stages, including bootstrap/setup fixtures, vehicle/maintenance/Firebase authorization, provisioning, mileage consistency, migration preservation, and Service History CRUD/rollback.

| Executed check                                                                         | Result                                                                                                 |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Chronological migration application and all applicable SQL suites                      | PASS                                                                                                   |
| Forced RLS, Firebase owner isolation, cross-owner denial and guarded completion writes | PASS                                                                                                   |
| DIY/workshop CRUD, multiple operations, invalid data and transaction rollback          | PASS                                                                                                   |
| Complete vehicle/maintenance row equality across Task 3 migration                      | PASS                                                                                                   |
| Service insert/edit versus vehicle mileage races                                       | 12 PASS, both write orders, three isolation levels                                                     |
| Maintenance insert/edit versus vehicle mileage races                                   | 12 PASS before and after migration; conflicting linked-completion changes remain guarded               |
| Linked service edit versus schedule deletion/interval edits                            | 9 PASS, including deletion-first rejection and rollback                                                |
| Concurrent owner provisioning                                                          | 8 simultaneous requests PASS                                                                           |
| Blocked migration installation                                                         | PASS: `55P03` after bounded lock wait; rows, grants and old guard unchanged; no partial history schema |
| Prepared read-only postflight query                                                    | PASS locally after migration                                                                           |

Mirrored the relevant production `postgres` default grants to anonymous/authenticated/service roles. Service RPC execution also passed with a separate **NOSUPERUSER/BYPASSRLS** function owner, matching production's privilege posture rather than relying only on a local superuser. The real production migration executor was not exercised; this is a local runtime-owner simulation.

The added lock-order test initially reproduced **`40P01` deadlock** when a visit edit replaced operations while a maintenance schedule was being deleted. The revised RPC locks linked schedules with `FOR KEY SHARE`, in UUID order, before locking/replacing visit operations. All nine targeted races subsequently passed. Expected `40001` snapshot conflicts at stronger isolation levels are explicitly rolled back and retried by the harness; a deletion-first edit returns `42501` or `40001` without changing the retained operation snapshot. These safe rejections are not classified as deadlocks or consistency failures. Arbitrary multi-resource interleavings are not exhaustively proven.

Final fictional-data query returned zero vehicles, visits and operations. The disposable database was dropped, server stopped, and this audit's cluster directories removed. No live database was used for fixtures or destructive testing.

The prior full regression run passed **205 automated tests across 25 files** and its recorded lint, formatting, build and security checks. In this follow-up, **224 automated tests across 28 files passed**; ESLint completed with no errors and one warning in an ignored `.tmp` browser fixture; Prettier, production build, source secret scan, Gitleaks publication preflight (131 candidates; no findings), and npm audit (**zero vulnerabilities**) passed. The existing bundle-size advisory remains. The full disposable PostgreSQL 17.10 runner also passed the open-tab migration harness, compatibility SQL, RLS/preservation suites, and service/maintenance/provisioning concurrency checks. Only the ignored browser harness was adjusted to wait for save completion before asserting database state; application source was not changed in this follow-up. Real provider/PostgREST acceptance remains unverified.

## Production migration preflight

Target link verified as **`ttwlscydylnaogawmgce`**. Supabase CLI 2.120.0 was used for migration history, dry-run and metadata queries; it logs login-role initialization as part of its connection setup. Remote SQL explicitly used read-only transactions with bounded statement/lock waits and rollback. Only metadata, booleans and aggregate compatibility counts were returned; no personal records or credentials were exported.

Remote migration history matches the first four local versions:

1. `202610100001_create_vehicles.sql`
2. `202610110001_maintenance_schedules.sql`
3. `202610110002_firebase_identity.sql`
4. `202610120001_vehicle_maintenance_consistency.sql`

The CLI **dry-run** identified exactly one pending file, no seeds and no role files: **`supabase/migrations/202610120002_service_history.sql`**. Its SHA-256 at verification is:

```text
6be7a56e558366e502f7118d0ae0aa94d8e5cd66ebe5b2bde699bae7c9cb1da2
```

The read-only production catalog matched the pre-Task-3 PostgreSQL 17 baseline: **8 tables, 53 columns, 49 constraints, 13 indexes, 10 policies, 4 triggers, 5 function definitions and 18 effective role/table grant summaries**. No drift was found in these application dependencies; unrelated Supabase/platform schemas are outside that comparison.

Production compatibility checks returned **zero** mileage inconsistencies, orphan maintenance records, orphan vehicle owners, unsupported completion dates and inconsistent completion statuses. The new table/RPC names are available. The expected Firebase project matches. Existing protected functions have fixed empty search paths; the production `postgres` function owner is not a superuser and has BYPASSRLS. Anonymous/authenticated users cannot create objects in `public`. Observed broad Supabase default grants are explicitly revoked where required by the new migration and were mirrored in local tests.

The refreshed lock snapshot reported zero transactions older than one minute and zero waiting application locks. This is a point-in-time observation, not a promise that a later rollout cannot encounter contention.

## Migration behavior and rollout blocker

The migration adds new history tables, constraints, indexes, read policies and owner-checked RPCs; updates the existing vehicle mileage guard; and retains the existing narrow completion-column grants for legacy clients. It does not rewrite, delete or fabricate existing vehicle/maintenance records. Its explicit table lock is SHARE ROW EXCLUSIVE on vehicles and maintenance: reads remain possible while writes wait. It now sets **5-second lock timeout** and **60-second statement timeout per statement**, scoped to its transaction. Lock-timeout rollback was actually tested.

The completion trigger keeps the legacy and Service History sources from becoming competing writers. Ordinary legacy maintenance updates, including unchanged completion fields in the old payload, remain allowed. Legacy completion changes are allowed until a linked service operation exists; after linking, changing those completion fields is rejected with `23514`, while schedule-only edits continue to work. The Service History projection uses the latest linked completion and leaves stored legacy baselines and permanent schedule intervals intact. SQL compatibility tests and the browser harness both exercised this boundary.

The open-tab harness opened legacy and updated maintenance edit forms against the old schema, applied the migration while both tabs remained open, then saved from each tab without reload. Both schedule edits succeeded and preserved completion values. It also verified that a linked completion conflict is rejected atomically and that the feature-off client makes no Service History requests. The flag is build-time: only `VITE_SERVICE_HISTORY_ENABLED=true` enables the section; keep the default-off build until the migrated schema and API are ready. This evidence removes the need for a separate bridge solely to support the old maintenance payload, but does not establish compatibility of the currently served production bundle, Firebase authentication, PostgREST schema-cache behavior, or token recovery.

### Client/schema compatibility matrix

`PASS` refers to isolated local PostgreSQL/browser-fixture evidence, not a live provider acceptance test.

| Case | Client and schema scenario                                                          | Result                       |
| ---- | ----------------------------------------------------------------------------------- | ---------------------------- |
| A    | Legacy maintenance form on the old schema: ordinary schedule edit                   | PASS                         |
| B    | Updated client, feature off, on the old schema: schedule edit                       | PASS                         |
| C    | Legacy maintenance payload on the new schema with unchanged completion fields       | PASS                         |
| D    | Updated client, feature off, on the new schema: schedule-only edit                  | PASS                         |
| E    | Legacy client on the new schema: edit a schedule linked to history                  | PASS                         |
| F    | Updated client, feature off, on the new schema: edit a linked schedule              | PASS                         |
| G    | Legacy completion change on the new schema before any history operation is linked   | PASS                         |
| H    | Legacy completion change on the new schema after a history operation is linked      | PASS: rejected atomically    |
| I    | Feature-off client opens a history deep link                                        | PASS: falls back to Overview |
| J    | Feature-off client on the old schema issues no history-table/API requests           | PASS                         |
| K    | Authenticated SQL CRUD for DIY/workshop visits, multiple operations, and rollback   | PASS                         |
| L    | Vehicle and maintenance rows before/after migration; legacy baseline remains intact | PASS                         |
| M    | Real Firebase + PostgREST browser/API, schema-cache and token-recovery acceptance   | NOT VERIFIED                 |

The matrix uses repository legacy/current UI fixtures; the currently served production frontend bundle was not fingerprinted. Do not infer full end-to-end client compatibility from these local tests.

## Remaining risks and final gates

- Complete real Firebase JWT, provisioning/token recovery, Supabase/PostgREST RPC and browser CRUD acceptance in a separately authorized disposable environment. Fixture browser results do not satisfy this gate. Keep the feature flag off until the migrated schema and API are ready.
- Exact PostgreSQL 17.11 tests were unavailable through the chosen package; rerun on 17.11 when the disposable Supabase acceptance environment is available.
- Verify backups/recovery readiness and recheck target, migration checksum, history, grants, compatibility and locks immediately before any separately authorized migration.
- Normal serialization conflicts and ambiguous network outcomes require deliberate retry/reload handling; do not blindly replay create requests or weaken owner checks.

The database checks are green, but **NO-GO remains the overall migration deployment recommendation** until real authentication/API acceptance, exact PostgreSQL 17.11 testing and recovery readiness are verified. No production data was modified, remote migration applied, website deployed, or Git commit/push performed.

## Files changed in this verification

- `supabase/migrations/202610120002_service_history.sql`: schedule lock ordering and migration timeouts.
- `supabase/tests/service_history_rls.sql` and `supabase/tests/service_history_legacy_compatibility.sql`: ownership, grant and guarded legacy completion regressions.
- `scripts/test-service-history-lock-order.mjs`: new deterministic deadlock regressions.
- `scripts/test-service-history-migration-lock.mjs`: new bounded installation/rollback regression.
- `.github/workflows/ci.yml`: run both new database regressions.
- `supabase/checks/service_history_preflight.sql`: reusable read-only production preflight.
- `supabase/checks/service_history_postflight.sql`: prepared read-only post-migration checks, exercised locally only.
- `docs/task3-predeployment-verification.md`, `docs/task3-rollout-plan.md`, and a follow-up pointer in `docs/task3-independent-audit.md`.

Ignored `.tmp` contains the isolated runner, PostgreSQL 17 tools, scoped catalog comparisons and local postflight metadata. It contains no exported production vehicle/account records.
