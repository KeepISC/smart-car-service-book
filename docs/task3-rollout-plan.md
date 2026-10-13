# Task 3 coordinated rollout and recovery plan

Current status, 13 October 2026: the explicitly approved migration was applied in Task 3.7.8b, authenticated Firebase/PostgREST integration passed in Task 3.7.9, and authorized fictional-record CRUD and cleanup passed in Task 3.7.10. Do not reapply the migration. The repository flag remains disabled by default; no production frontend release or activation has occurred. See the [final verification](task3-final-verification.md) for publication readiness and remaining limitations.

The sequence below is the retained rollout/recovery procedure, not authorization to repeat completed operations. Target: `ttwlscydylnaogawmgce`, production PostgreSQL 17.11. Migration: `supabase/migrations/202610120002_service_history.sql`.

## Gates before requesting migration authorization

1. Freeze the reviewed migration and frontend artifacts. Compare the migration SHA-256 with the verification report. Rerun PostgreSQL authorization, concurrency, migration rollback and frontend regressions after any further edits. Never amend a migration that has already been applied remotely.
2. Use a separately authorized disposable Supabase environment with the same schema and Firebase integration. Prefer PostgreSQL 17.11. Use dedicated fictional test accounts and vehicles; never copy production owner/account/vehicle records into the public repository. Provisioning must use a verified Firebase token and the normal trusted service, not a frontend-selected owner UUID.
3. Keep the Task 3 build-time flag `VITE_SERVICE_HISTORY_ENABLED` false until the new schema and API are ready. The migration retains narrow legacy completion-column grants: unchanged legacy completion fields and ordinary schedule edits remain compatible, while a trigger rejects changes to a completion already represented by linked Service History. A separate bridge is not required solely to support old maintenance payloads. Do not enable history before schema/API readiness.
4. Test legacy and updated client/schema combinations, including open old tabs, cached assets and session restoration. The local PostgreSQL 17.10 harness has verified pre-migration edits, both open tabs saving after migration without reload, linked schedule-only edits, and atomic rejection of conflicting completion changes. Confirm the currently served production bundle and its cache/session behavior separately; local fixtures do not establish production client identity or live provider behavior.
5. Complete disposable browser acceptance with real Firebase and Supabase: two-owner read/write isolation, DIY/workshop visits, scheduled/custom multiple operations, costs, overrides, edits, deletion, historical/same-day ordering, maintenance baseline fallback, schedule deletion snapshots, mileage rejection, token refresh/recovery, and existing garage/vehicle/schedule flows. Repeat responsive/theme checks at 320, 375, 390, 768, 1024 and 1440 px. Confirm PostgREST discovers the relations/RPC signatures and propagates rollback/permission errors correctly. Clean up all fictional records and test identities.
6. Review the [verified executable application-data recovery procedure](#task-376c-verified-executable-application-data-recovery). Task 3.7.6c verifies isolated restoration with the existing archive and closes the executable local runbook gap. Complete managed Supabase/PITR recovery remains untested. Retain a tested feature-off frontend artifact as the recovery target. Obtain explicit authorization for the production migration and any production deployment/configuration action only after these gates pass.

## Authorized migration sequence

1. If a frontend refresh is needed, deploy an authorized Task 3 build with history disabled. Verify normal Firebase sign-in, garage/vehicle CRUD and schedule-only maintenance editing against the existing schema. The local compatibility tests support ordinary older-client schedule mutations across migration, but do not identify the currently served production bundle. Keep the history feature off through migration and API checks.
2. Reconfirm the link/endpoint is `ttwlscydylnaogawmgce`. Run the read-only `supabase/checks/service_history_preflight.sql`, compare scoped schema metadata, and rerun the pinned CLI migration dry-run. Expect exactly the four previously applied versions and only `202610120002_service_history.sql` pending. Stop for new files, drift, incompatible data, collisions or unexpected permissions. Take private aggregate preservation fingerprints during the quiet window; do not export real rows into this repository.
3. Apply **only the reviewed pending migration**, using the established migration executor after explicit authorization. Never run `supabase/tests/bootstrap.sql`, SQL fixtures, or any concurrency harness on production. The migration is transactional, with a 5-second lock timeout and 60-second timeout per statement. Its SHARE ROW EXCLUSIVE locks permit reads but block writes; failed lock acquisition must abort the attempt rather than wait indefinitely. Monitor connection/transaction contention and stop before enabling history on any unexpected result.
4. Verify migration history and actual objects agree. Run read-only `supabase/checks/service_history_postflight.sql`; all permission/RLS booleans must be true, the RPC owners must have the expected definer/empty-search-path/BYPASSRLS posture, and all consistency counts must be zero. Compare RPC definitions/hashes with the tested local definitions and preservation fingerprints before allowing new writes. New history tables must not contain fabricated baselines. Verify existing Firebase/owner policies, template reads and mileage guards remain intact.
5. Verify the authenticated Supabase API sees the new tables and exact RPC signatures. If its schema cache is stale, keep history disabled and use only an explicitly authorized supported cache-reload procedure; do not alter RLS or grant direct table writes as a workaround.
6. Release the authorized Task 3 frontend only after the database/API checks pass. Keep history gated for the final smoke checks. Use real Firebase authentication for production read-only acceptance of existing garage, vehicles and maintenance; full destructive browser CRUD belongs in the disposable environment. Any production fictional-account/record write or cleanup needs separate explicit authorization and must never touch an existing owner's records.
7. Enable the new UI only after acceptance, with a tested compatible recovery artifact available. Monitor authorization errors, missing RPC/schema errors, serialization/deadlock rates, mileage rejections and frontend load failures. Compare metrics with the known acceptable behavior and stop enabling further usage when correctness or availability is uncertain.

## Recovery strategy

- **Before migration or on lock/statement failure:** keep the history feature off. Verify transaction rollback, grants/guard and migration ledger before retrying. The local blocked-installation regression confirms no partial application under a lock timeout.
- **Unknown migration outcome after a connection failure:** inspect both migration history and actual tables/functions/grants. Do not blindly rerun, mark a migration applied, reverse statements, or repair the ledger. Resolve the discrepancy under separate authorization.
- **Migration committed but frontend/API acceptance fails:** keep the new schema and its data/security protections. Keep or release a verified feature-off client; ordinary schedule and vehicle paths can remain available, including legacy payloads that do not conflict with linked completion history. Conflicting legacy completion edits remain intentionally rejected. Resolve schema-cache or frontend defects and rerun acceptance.
- **Need to stop cached/API clients from writing:** a UI flag alone is not an authorization boundary. A separately approved forward permission change may pause authenticated service RPC execution while keeping data readable; verify effective grants afterward. Do not weaken owner checks, disable RLS, or restore direct completion editing.
- **Database defect after writes have begun:** use a reviewed forward repair migration. Preserve service visits/operations and legacy baselines; retain the expanded mileage guard. Do not drop history tables, delete visits, or revert the guard to its legacy-only version as a routine rollback.
- **Disaster recovery:** backup restoration is a separate approved operation because it can discard newer valid records. Establish the affected time range and preservation/reconciliation plan before restoring. Never assume a down migration is a safe recovery path.

This plan does not authorize or perform any production mutation. Reassess GO/NO-GO once disposable real-authentication/API acceptance, exact-version PostgreSQL testing and recovery readiness are evidenced.

## Task 3.7.5 isolated backup restoration record

**Result: PASS WITH CONDITIONS.** Evidence is the verification summary supplied from the ChatGPT project conversation following Task 3.7.5, not the original terminal transcript. Task 3.7.6b documents that summary without recreating the backup or running another restoration. Exact restore commands, dependency setup SQL and cleanup commands were not retained. The procedure below records the reported stages and verification criteria; it is not a previously tested executable runbook.

### Private backup and checksum

The PostgreSQL custom archive is held in the operator's private backup directory outside the repository. Its absolute directory and archive path were supplied in the private Task 3.7.5 conversation; retrieve them there. Keep that location in private operational records, not Git. Do not copy the archive, credentials, restored rows or ownership mappings into this repository.

Recorded archive SHA-256:

```text
855e575ce4d184e9a3c70ef2d759c76521dcccf08917ad73233f46d5917bff42
```

To verify the archive, run `Get-FileHash -LiteralPath <private-archive-path> -Algorithm SHA256` in PowerShell, substituting the privately recorded path. Compare the complete hash with the value above before use and again afterward. This is a checksum instruction, not a recovered Task 3.7.5 command. The summary reports that the checksum remained unchanged through restoration.

### Version, utilities and dependencies

- The tested isolated restore target was **PostgreSQL 18.4**. The rollout target is PostgreSQL 17.11; restoration on 18.4 does not establish restoration compatibility on 17.11. Service History migration regression testing on PostgreSQL 17 is separate evidence.
- A custom archive requires `pg_restore`; PostgreSQL server/cluster utilities and a SQL client such as `psql` are needed to prepare and inspect an isolated target. The summary does not retain utility versions, archive producer version, restore flags or executable paths. These must be established before constructing an executable runbook.
- Roles, extensions and authentication-function dependencies were prepared separately. Their complete names, attributes, grants and setup SQL are absent from the summary. The repository's disposable bootstrap defines `anon` and `authenticated`; Firebase identity SQL defines `scsb_provisioner`. These references are not proof of the exact role setup used in Task 3.7.5. Verify the archive's required roles and function owners privately, including privilege and forced-RLS requirements, before restoring.
- Local `auth.jwt()` and `auth.uid()` shims were used for database verification. The repository's `supabase/tests/bootstrap.sql` illustrates disposable authentication dependencies, including `auth.users`; it is a test fixture, not a verified backup restore script. Never run it against a Supabase project or assume its fixtures reproduce real authentication.
- Required extensions were reported as prepared, but their names and versions were not recorded. Do not infer a complete extension manifest from application migrations. Recover and verify that manifest before treating the instructions as executable.

### Reported isolated restoration procedure

1. Use a fresh disposable PostgreSQL 18.4 cluster and database, separate from live Supabase/Firebase and all pre-existing local databases. Privately record the cluster's exact data directory, endpoint, port and database identity so preparation, restoration and cleanup can be scoped to that target.
2. Verify the private archive checksum and prepare the required roles, extensions and authentication-function dependencies in that isolated database. The precise preparation SQL is unavailable.
3. Restore the custom archive into the prepared isolated database. The final restoration completed without reported warnings or errors. Exact `pg_restore` arguments, object selection, ownership handling and retry sequence are unavailable; no command line is represented here as previously executed.
4. Compare the restored database against the backup privately using the checks below, then recheck the archive checksum. Do not use production test writes or publish restored records.
5. Stop and remove only the disposable resources. The summary reports that disposable PostgreSQL clusters were stopped and removed and that live services and pre-existing local databases were untouched.

### Restored-state verification

All nine tables reportedly matched the backup:

| Table                                         | Rows |
| --------------------------------------------- | ---- |
| `public.vehicles`                             | 1    |
| `public.vehicle_maintenance_items`            | 5    |
| `public.maintenance_templates`                | 0    |
| `public.maintenance_template_items`           | 0    |
| `app_private.app_users`                       | 3    |
| `app_private.firebase_config`                 | 1    |
| `app_private.firebase_identities`             | 3    |
| `app_private.firebase_provisioning_approvals` | 3    |
| `supabase_migrations.schema_migrations`       | 4    |

Verification must compare records as well as counts: equal counts alone do not establish preservation. The summary reports timestamps compared by instant, preserved ownership records and Firebase mappings, preserved migration history, and no record loss or duplication. It also reports five functions, four triggers and ten RLS policies verified; required privileges and forced RLS verified; ownership foreign keys and cross-owner isolation effective; and both vehicle/maintenance mileage guards effective. The individual SQL assertions and detailed object inventories were not retained, so these results cannot substitute for executable verification queries.

These are the pre-Service-History backup's recorded counts, not universal recovery expectations. Verify migration history against the archive's actual schema; do not insert ledger entries or apply pending migrations merely to match a later application build.

### Cleanup boundaries

Before any later cleanup, verify the target server's data directory and database identity against the privately recorded disposable resources. Stop that cluster, confirm it has stopped, and remove only its exact disposable data directory and test artifacts. Preserve the private backup archive and unrelated local databases. Do not delete a shared parent directory, use broad path patterns or stop an unidentified server. The original stop/removal commands are unavailable; this describes the required boundary, not a reconstructed tested command sequence.

### Recovery scope and remaining gaps

The reported restoration supports **application-data recovery once its dependencies are prepared**. Authentication shims exercised database behavior; actual Supabase authentication services and Firebase authentication were not reproduced or tested. Restoring tables, ownership mappings, migration history, triggers, privileges and RLS does not restore external identity providers, managed-service configuration or the complete Supabase platform. Full managed-service disaster recovery and PITR remain untested.

At the close of Task 3.7.6b, the recovery instructions were **not a complete executable runbook**. The original Task 3.7.5 commands remain unavailable. Task 3.7.6c supplies a newly executed, repeatable local procedure below; it does not reconstruct missing historical commands or establish managed-service recovery.

## Task 3.7.6c verified executable application-data recovery

The executable procedure is [verify-isolated-recovery.mjs](verify-isolated-recovery.mjs). It accepts only the archive and restore executable paths; it creates its own loopback PostgreSQL server and accepts no existing database endpoint. Run it from the repository root. It reads the original archive without changing it, retains private records only in process memory and the disposable database, and prints aggregate results rather than row contents. Do not redirect raw backup SQL or database error details into repository files.

### Prerequisites and prepared dependencies

- Existing ignored local infrastructure: `.tmp/postgres-tools/node_modules/embedded-postgres` version `18.4.0-beta.17`, with PostgreSQL **18.4** binaries, and the repository's installed `pg` package and Node.js **24.11.0**. No package installation was required for this verification.
- `pg_restore` **18.6** from the locally installed PostgreSQL 18 utilities. Archive metadata identifies source PostgreSQL **17.11** and producer `pg_dump` **18.6**. No new `pg_dump` was run. This verifies restoration to 18.4, not restoration to 17.11.
- The existing private custom archive must match the SHA-256 recorded above. Its path remains in private operational records. The helper asserts this hash before creating a cluster and again before cleanup.
- The helper creates `postgres` as the isolated bootstrap superuser, with a randomly generated local password held in memory. `pg_database_owner` is built in. Separately prepared roles are `anon`, `authenticated`, `service_role`, `supabase_admin` and `scsb_provisioner`, all NOLOGIN. `service_role` has BYPASSRLS; `scsb_provisioner` is NOSUPERUSER/NOCREATEDB/NOCREATEROLE/NOBYPASSRLS. `supabase_admin` exists to restore default ACL entries; this is not a recreation of Supabase's managed administrator.
- The helper creates the `auth` schema, grants its usage to `anon` and `authenticated`, and installs local `auth.jwt()` and `auth.uid()` shims using transaction-local request settings. The executable includes the exact setup SQL. This archive does not require an `auth.users` table for its restored foreign keys; vehicles reference `app_private.app_users`.
- This archive has no extension entries. The five restored application functions use PostgreSQL's built-in SQL/PLpgSQL facilities and `gen_random_uuid()`, whose availability is asserted before restore. No additional extension installation was needed in this test. Other archives or managed schemas may require additional dependencies.
- A fresh database already has `public`; the helper drops that empty schema only inside its newly created database so the archive can recreate it with its recorded owner and ACLs. It never drops a schema in an existing database.

### Commands executed

The actual invocation used the private archive path and local utility path as environment values. They are represented by placeholders here to keep private paths out of Git:

```powershell
$env:SCSB_RECOVERY_ARCHIVE = '<absolute-private-archive-path>'
$env:SCSB_PG_RESTORE = '<absolute-local-pg_restore.exe-path>'
node docs/verify-isolated-recovery.mjs
```

The helper executes these utility arguments through `execFileSync`, not shell interpolation:

```text
pg_restore --version
pg_restore --list <archive>
pg_restore --data-only --file=- <archive>
pg_restore --host=127.0.0.1 --port=<new-loopback-port> --username=postgres --dbname=recovery_test --exit-on-error --single-transaction <archive>
pg_ctl -D <this-run-disposable-directory> -m fast -w stop
```

The data-only output is captured in memory for comparison and is never printed or saved. The restore retains ownership and ACLs: no `--no-owner`, `--clean` or `--create` flags are used. Every inherited `PG*` environment variable is removed for the restore subprocess; only the helper's explicit loopback host, new port, database, user, temporary password and `PGSSLMODE=disable` are set. SSL is disabled only for this local disposable connection. During reconstruction, the empty-table parser, target `public` schema preparation, PostgreSQL environment isolation, mileage-test fixture and graceful Windows shutdown were corrected. The final helper passed; all disposable resources created by these attempts were removed. One stopped directory with a stale PID file was removed only after `pg_ctl -D <that-exact-directory> status` returned exit code 3 (no server running).

### Preparation and verification performed by the helper

1. Read and checksum the archive, inspect archive metadata, and parse its nine COPY sections privately. Reserve an unused loopback port and create a unique `.tmp/recovery-*` directory with `mkdtemp`. A port bind race aborts startup; the helper does not attach to another server.
2. Initialize and start PostgreSQL with `EmbeddedPostgres.initialise()` and `.start()`, then `.createDatabase('recovery_test')`. Verify `server_version` is 18.4 and `data_directory` equals this run's unique directory before preparation or restoration.
3. Prepare the roles and authentication functions, then restore the archive atomically with the command above. Abort on the first utility error; raw error details are suppressed because they can contain private records.
4. For each restored table, load the archive's COPY records as typed parameters into a transaction-local comparison table. Compare both directions with `EXCEPT ALL`, preserving duplicate detection and timestamp comparison by instant. Assert all nine record sets match and their counts equal the Task 3.7.5 table above. This includes all ownership mappings and all four migration-history records, not just their counts.
5. Verify the five application function names, four enabled non-internal trigger names and ten RLS policy names. Trigger and policy names must match archive metadata. Verify all eight application tables have enabled and forced RLS, no orphan vehicle owners or identity owners, and a validated vehicle-to-application-owner foreign key. Verify both security-definer functions have empty search paths and representative effective table, column and provisioning-function grants/denials.
6. For each of the three restored enabled Firebase identities, set local claims through the shim under `authenticated`. Verify `current_app_owner()` resolves the preserved UUID, no other owner's vehicles or maintenance are visible, and cross-owner vehicle updates affect zero rows. All transactions are rolled back; actual Firebase tokens or services are not used.
7. In rolled-back local transactions, verify negative vehicle mileage is rejected and maintenance completion above vehicle mileage is rejected. This archive has no positive completion baseline, so prepare a completion of 10 and vehicle mileage of at least 20 inside another local transaction, verify the vehicle trigger rejects mileage 9 with the expected consistency constraint, and roll back the entire test fixture. Recalculate the original archive checksum.

The helper's assertions are the executable verification queries. Checks cover the stated object inventories and security behavior; they are not a byte-for-byte comparison of every function definition, grant or platform object.

### Exact cleanup scope

The helper closes its SQL client and uses the embedded PostgreSQL 18.4 `pg_ctl.exe` with `-D <this-run-directory> -m fast -w stop` for graceful shutdown. This avoids the embedded library's Windows forced-process-stop fallback. It clears the library's child-process bookkeeping after shutdown so its exit hook does not stop the exited child again, and requires that this directory's `postmaster.pid` no longer exists. It then checks the resolved directory is an immediate child of the repository's `.tmp` directory with the generated `recovery-` prefix before calling `rm(directory, { recursive: true, force: true })`. It does not enumerate or remove other clusters, drop existing databases, stop existing servers, or remove the archive. If shutdown cannot be confirmed, it leaves the directory for investigation instead of deleting it. The success log must include `CLEANUP own disposable server stopped and exact cluster directory removed`; an interrupted run requires separately verifying its specific directory and server before manual cleanup.

### Evidence and remaining limits

**Final result: PASS on 2026-10-13.** The final helper exited with code 0 on PostgreSQL 18.4 using `pg_restore` 18.6. All nine table record sets and counts matched, the object/security/ownership checks passed, both mileage guards rejected invalid writes, the archive SHA-256 was unchanged, and the newly created cluster was stopped and removed. No live Supabase/Firebase connection was made and no pre-existing database was overwritten.

The executable **isolated application-data recovery procedure is complete for this archive and tested local infrastructure**. It requires the prepared dependencies above. Supabase managed roles are approximated locally and restored functions are owned by the isolated bootstrap superuser; production's NOSUPERUSER/BYPASSRLS definer posture is not reproduced by this restore test. Actual Supabase Auth, Firebase, PostgREST, schema-cache behavior, storage objects, external configuration, backup retention and PITR are outside this procedure. The archive predates Service History and does not recover later history records. A complete Supabase platform disaster-recovery plan remains unverified, and production restoration still requires separate authorization and reconciliation of newer valid records.
