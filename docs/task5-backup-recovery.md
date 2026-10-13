# Task 5 application backup and recovery checkpoint

Status on 2026-10-13: **PASS for isolated application-data recovery and predecessor
SQL equivalence. The archive captures the verified pre-Task-5 state.** Task 5
migration `202610130001` was subsequently applied to the linked project after
reconfirming the backup, predecessor ledger and captured schema. Database
postflight and the authenticated disposable-data RPC smoke test passed, including
test-data cleanup and existing-record preservation. See the
[rollout checkpoint](vehicle-mileage-history.md#database-rollout-checkpoint-2026-10-13).

The fresh custom archive, SHA-256 sidecar and snapshot manifest are stored only in
the existing private backup directory outside the repository. Private operational
records contain the exact filenames. No backup contents, credentials or personal
records belong in this document or Git.

## Backup procedure executed

The ignored local helper `.tmp/task5-create-backup.mjs` reused the existing private
`backup.env` PostgreSQL configuration and the installed `pg_dump`/`pg_restore` 18.6
utilities. It verified the linked project and opened a REPEATABLE READ, READ ONLY
transaction on PostgreSQL 17.11 with TLS certificate/hostname verification.

It captured schema metadata, table counts, row fingerprints and all five migration
ledger records, then exported that transaction's snapshot. `pg_dump --format=custom`
used the same snapshot and included `public`, `app_private` and `supabase_migrations`.
Those schemas contain eleven tables, including Service History visits/operations.
The dump subprocess was also configured read-only and used a five-second lock wait
timeout. No production data, schema or migration state was changed.

The helper chose a new timestamped archive filename without overwriting prior
backups. Archive inspection confirmed both Service History tables. SHA-256 was
computed and checked again; the hash and private manifest were written beside the
archive. Integrity verification passed. Integrity alone does not establish recovery.

## Disposable restore procedure and result

The existing [Task 3 recovery helper](verify-isolated-recovery.mjs) now accepts the
fresh private manifest and a selectable local PostgreSQL major version. Omitting
those optional settings retains its original Task 3 archive verification mode.
For the new archive, use this invocation from the repository root:

```powershell
$env:SCSB_RECOVERY_ARCHIVE = '<absolute-private-archive-path>'
$env:SCSB_RECOVERY_MANIFEST = '<archive-path>.manifest.json'
$env:SCSB_PG_RESTORE = '<absolute-local-pg_restore.exe-path>'
$env:SCSB_RECOVERY_POSTGRES_MAJOR = '17'
node docs/verify-isolated-recovery.mjs
```

The helper validates archive/manifest/sidecar SHA-256 before creating a unique
loopback cluster and verifies its data directory. It prepares the Task 3 local role
and auth-function dependencies, then runs `pg_restore --exit-on-error
--single-transaction` into its new database, retaining owners and ACLs. Inherited
`PG*` settings are removed; all restore connections are explicitly local.

The existing Task 5 archive was reused; no replacement backup was created.
Archive, manifest and sidecar SHA-256 matched before restoration. The corrected
helper exited successfully after a transactional restore into PostgreSQL 17.10.

### Root cause and confirmed fixes

The exact failing assertion was the `assert.deepEqual(local[key], source[key])`
comparison with `key === 'table_acl'`. Four `app_private` tables (`app_users`,
`firebase_config`, `firebase_identities`, `firebase_provisioning_approvals`) had
the explicit ACL `{postgres=arwdDxtm/postgres}` in the captured source metadata.
Their restored raw `pg_class.relacl` was NULL. The verifier converted NULL to an
empty array, incorrectly treating PostgreSQL's implicit owner privileges as absent.

`pg_dump`/`pg_restore` can represent those same owner permissions using the default
ACL. This was a verification defect, not missing privileges or backup corruption.
[application-backup-metadata.sql](application-backup-metadata.sql) now expands
NULL table ACLs through `acldefault('r', relowner)`. The helper also expands NULLs
in the original manifest using its recorded table owner; this was required for the
captured migration table, whose source ACL was already NULL. Explicit empty or
revoked ACLs remain distinct from implicit defaults. Existing owners, grantees,
privileges, column grants, RLS and all other captured schema checks remain strict.

Diagnostic output identifies mismatching schema sections/field paths and hashes
without printing private metadata or rows. The ledger verifier similarly reports
an SQL mismatch without dumping expected/actual statement contents.

### Verification actually completed

- All nine captured catalog sections matched: tables/owners/RLS, columns,
  constraints, indexes, function definitions/owners/ACLs, triggers, policies,
  table ACLs and column ACLs.
- All eleven restored table counts and SHA-256 row fingerprints matched the
  read-only source snapshot. Every archive row was independently compared using
  typed temporary tables and bidirectional `EXCEPT ALL`, including ownership
  mappings, vehicle/maintenance data and all five migration records.
- Eight functions, seven enabled triggers, twelve policies, ten application tables
  with forced RLS, validated ownership references and representative effective
  grants/denials passed. Firebase ownership resolution and cross-owner isolation
  passed under the local authentication shims.
- Rolled-back invalid mileage/completion writes were rejected. A separate fictional
  ACL probe proved implicit and explicit full-owner grants compare equally, while
  added authenticated grants and revoked owner privileges remain detectable.
- The archive SHA-256 was unchanged after verification. Task 5's table is absent.

Both Service History tables were empty in the captured source snapshot and restored
as empty. Their schema, functions, RLS and zero-row fingerprints were verified;
this archive does not demonstrate restoration of populated Service History records.

The helper gracefully stopped its own server and removed only the checked, unique
disposable cluster directory. The original archive was not modified. Production
was never a restore target. No live connection was made by these diagnostic and
restore runs.

## Predecessor verification and limitations

The backup snapshot records exactly `202610100001`, `202610110001`, `202610110002`,
`202610120001` and `202610120002`. Task 5 is not recorded or included.

Supabase's ledger contains version, name and SQL statements rather than original
SHA-256 values. [verify-migration-ledger.mjs](verify-migration-ledger.mjs) is prepared
to compare the five local files with those ordered recorded statements, ignoring
outer comments/formatting and CRLF/LF representation while preserving quoted
content and function bodies. It writes only an aggregate verification record next
to the private archive. It **passed for all five predecessors**, comparing 124
ordered statements (15, 27, 39, 9 and 34 respectively), including function bodies.
The private verification record includes local file hashes and canonical SQL hashes.
There is no original checksum column to verify byte-for-byte historical file hashes;
SQL equivalence is established against the ledger captured in the backup snapshot.
The current remote ledger was not queried again during that local-only
investigation. Before the subsequent authorized rollout, all five current remote
ledger records were compared with the backup snapshot and the predecessor files
were checked against the private SQL-equivalence verification record.

This is an application-schema/data archive, not a full Supabase platform backup.
Managed authentication, storage, Firebase configuration/credentials, PostgREST,
retention and PITR are outside its scope. Local auth functions are shims; local
bootstrap privileges differ from production. The original manifest does not include
separate namespace ACL/default-privilege catalog sections; those archive entries
are restored, but are not independently compared with a source-snapshot manifest.
PostgreSQL 17.10 is a different patch
release from production 17.11. No production recovery or application deployment
was attempted. The subsequent authorized Task 5 migration does not change this
archive: it contains neither the mileage-history schema nor records created after
its snapshot. Production recovery would need separate authorization, reconciliation
of newer records and a reviewed procedure for restoring the pre-migration archive
and reapplying later migrations.
