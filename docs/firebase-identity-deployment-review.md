# Firebase identity migration deployment review

Reviewed on 11 October 2026. Migration: `202610110002_firebase_identity.sql`.

**Security review: PASS. Live Firebase readiness: FAIL until the separately approved database and server configuration is completed.** No SQL changes were needed. The migration was not applied.

## Verified target and migration history

- Linked Supabase project: `smart-car-service-book`, reference `ttwlscydylnaogawmgce`, region `eu-west-1`, PostgreSQL 17. The frontend Supabase host matches this link.
- Applied remotely: `202610100001_create_vehicles.sql` and `202610110001_maintenance_schedules.sql`.
- Pending: only `202610110002_firebase_identity.sql`.
- Frontend and server environment project IDs both match `smart-car-service-book-61a9d`; no credential values were displayed.
- The remote private schema, provisioner role, owner function and mapping infrastructure are absent. The migration deliberately does not insert a Firebase configuration row.

The requested remote dry-run succeeded:

```powershell
npx.cmd --yes supabase@2.120.0 db push --linked --dry-run --skip-vault --output-format json
```

It reported only the pending identity migration, with no seeds or separate role-file changes. The SQL migration itself creates a role. Dry-run lists pending work; it does not execute the SQL or establish runtime correctness.

## Exact database changes

1. Create `app_private` and remove browser/public schema access.
2. Create `app_users`, `firebase_config`, `firebase_identities` and `firebase_provisioning_approvals`; enable and force RLS and revoke browser/public table access.
3. Copy existing `auth.users.id` UUIDs into `app_users` without updating source users or vehicle owners.
4. Create the `scsb_provisioner` group role and `app_private.provision_firebase_owner(text,text)` security-definer function. The role receives only private schema USAGE and EXECUTE on that function.
5. Create `public.current_app_owner()` with authenticated execution, a fixed empty search path, Firebase issuer/audience/verified-email/claim/mapping checks and the existing Supabase-session coexistence branch.
6. Replace `vehicles_owner_id_fkey` with an FK to `app_users`, preserving its cascade behavior; change the owner default to `current_app_owner()`.
7. Update four vehicle policies, four maintenance policies and verified-template read policy. Template-item access follows its existing parent-template policy. Existing application RLS remains enabled and forced.

All changes run in one transaction. There are no table drops, truncations, vehicle/maintenance deletions, owner reassignment statements or RLS-disabling statements. The only dropped object is the owner FK, which is replaced within that transaction.

## Security and ownership findings

- Public verified registration is supported. The trusted server verifies the Firebase ID token before calling the restricted function. PostgreSQL itself does not verify that token; server credentials are therefore a security boundary.
- A per-UID control-row insert and row lock serialize first requests before owner allocation. UID and owner uniqueness prevent duplicate mapping and legacy-owner theft. Owner creation and mapping commit together; claim failures retry the same UUID.
- No email is accepted by the ownership function. Legacy association requires independent proof and an explicit private association before first Firebase login. Established mappings cannot be reassigned through provisioning. Multiple providers must link to the same Firebase UID.
- `scsb_provisioner` is NOLOGIN, NOSUPERUSER, NOCREATEDB, NOCREATEROLE and NOBYPASSRLS. Disposable PostgreSQL checks confirmed schema USAGE and function EXECUTE, but no schema CREATE, browser function EXECUTE, vehicle SELECT or mapping INSERT privileges. It cannot directly read/write private tables or user records.
- Security-definer functions must remain owned by a trusted database owner able to access the forced-RLS private tables. Do not transfer them to the runtime login. The inspected remote tables are owned by `postgres`; the inspected privileged role bypasses RLS.
- The migration grants neither a runtime LOGIN nor credentials. Provisioning owner UUIDs never come from the frontend. Supabase's configured third-party gateway must verify Firebase signatures before claims reach RLS.

## Existing records and operational risks

Read-only live checks confirmed every vehicle has an existing legacy auth owner and every maintenance item references a vehicle. The current owner FK is present and validated. All four application tables have RLS enabled and forced, and their existing policy names match the migration.

The registry copies the same UUIDs, so the new FK preserves existing owner values. Vehicle and maintenance IDs and relationships remain unchanged. Local migration tests verified fictional legacy record preservation, stable mappings, returning-user retries, automatic new registration, revoked identities and cross-owner denial.

The FK replacement and policy DDL acquire locks and may briefly block concurrent traffic. Use a quiet window and keep the maintenance/provisioning cutover controlled. Constraint validation can fail if schema/data changes after this review; transactional rollback protects against a partial migration. A dry-run does not measure lock duration.

Deleting a legacy Supabase Auth user will no longer cascade into vehicles through that old FK. Deleting an application owner remains destructive because the new FK cascades; only a separately authorized account-deletion workflow should do that. Legacy association rows may also restrict owner deletion. Do not drop the registry or restore the old FK after new Firebase owners exist without a reviewed data migration.

Legacy users existing when the migration runs retain UUIDs and compatible Supabase sessions. Future Supabase registrations do not automatically enter the new registry; stop routing new signups through legacy auth during an approved cutover, or design separately reviewed registry synchronization. Late legacy association after automatic first login requires reviewed repair, never automatic reassignment.

## Prerequisites and exact next steps

1. Obtain explicit approval for applying this one pending migration to the verified project. Prepare a private backup and a quiet migration window. Recheck link/history and dry-run immediately before application if remote state has changed.
2. Apply through a trusted database operator with role-creation permission, schema CREATE, ownership/ALTER rights on the affected tables and the privileges needed by the security-definer functions. `anon`, `authenticated`, `auth.users`, `auth.jwt()`, `auth.uid()`, PL/pgSQL and `gen_random_uuid()` were confirmed available. PostgreSQL 17 provides the UUID generator; no new extension is required.
3. Through separately approved private database administration, insert the project configuration after migration:

   ```sql
   insert into app_private.firebase_config (project_id)
   values ('smart-car-service-book-61a9d');
   ```

   This is a one-time configuration, not a command executed by this review. Never silently replace an already configured project. Firebase access intentionally fails closed while the row is absent.

4. Create a dedicated PostgreSQL LOGIN using a password stored privately. Grant only membership in `scsb_provisioner` and database CONNECT if required. Ensure it has no privileged memberships, object-creation rights, table grants, superuser or BYPASSRLS privileges. Keep the existing trusted function ownership. Verify effective privileges after creation, including inherited/default grants.
5. Prepare independently verified legacy UID associations before enabling those users' first Firebase login. Do not expose owner UUIDs or account exports in source files. Ordinary new accounts need no manual approval.
6. Configure the server's Firebase Admin credentials, restricted database URL and trusted CA outside frontend files, and confirm the same Firebase project in Supabase's third-party integration through separately authorized settings. No private JWT signing secret is needed by Vite.
7. Start the local services as described in [local provisioning](local-provisioning.md), run the safe checker, then test fictional first/returning logins, refreshed `role`/`app_owner_id` claims, logout and direct cross-owner REST denial. Validate real Admin IAM permissions and gateway signature acceptance; local simulated claims cannot establish these.

**Safe to apply:** the reviewed SQL is suitable for an explicitly approved, controlled application to this verified schema. It is not a complete live-auth deployment. No migration, remote settings, deployment, commit or push was performed, and no credentials were exposed.
