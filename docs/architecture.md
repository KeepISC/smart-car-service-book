# Provider boundaries and PostgreSQL portability

**Current update:** [Firebase migration preparation](firebase-migration.md) replaces the Supabase authentication adapter with Firebase locally. The contract remains in `src/types/auth.ts`, now exposed as `authService`. Supabase SDK table queries remain in services; the client receives Firebase tokens through its official `accessToken` option. The discussion below describes the earlier Supabase identity dependencies that the pending migration adapts.

See [Future authentication providers](authentication-providers.md) for the Firebase-compatible Facebook/Apple design, stable owner identity and secure linking requirements. The runtime continues to use Supabase.

React pages and components use application types, `authService` from `src/services/auth.ts`, and the vehicle/maintenance service functions. They do not import the database/authentication SDKs or build database queries. `src/services/supabase.ts` is the connection adapter; `vehicles.ts` and `maintenance.ts` contain all table queries. `auth.ts` contains Firebase authentication calls and invokes the separate [trusted provisioning service](trusted-provisioning.md) before exposing an application session. The database token bridge stays in `firebaseToken.ts`. Firebase Admin and the restricted PostgreSQL login are server-only.

The small `Authentication` contract in `src/types/auth.ts` exposes configuration availability, identity/session restoration, session subscription and cleanup, email sign-in/registration, Google sign-in, and sign-out. Sessions exposed to React contain only application owner UUID and optional email, never access/refresh tokens or SDK metadata. Firebase handles local session persistence and token refresh. No provider registry, generic repository or dependency injection framework is introduced.

Maintenance calculations and validation in `maintenanceLogic.ts` use only application types and JavaScript date/number logic. Vehicle validation likewise has no provider dependencies. These modules can remain unchanged during a provider migration.

## PostgreSQL schema

Tables, UUID keys (`gen_random_uuid()`), foreign keys, indexes, check constraints, timestamps, PL/pgSQL triggers and row level security use PostgreSQL features. The updated-at and maintenance-completion trigger functions are application-owned PostgreSQL functions, not Supabase APIs. The schema uses the `public` schema and standard authenticated-role grants, including column-level update restrictions.

The Supabase-specific identity dependencies are:

- `vehicles.owner_id` references `auth.users(id)` and defaults to `auth.uid()`.
- Vehicle and maintenance owner policies use `auth.uid()` to determine identity.
- Grants/policies reference Supabase's `anon` and `authenticated` roles. Privileged administration may bypass RLS and must remain server-side.
- Verified catalog policies themselves use PostgreSQL predicates, but their authenticated reader role is supplied by Supabase.
- `supabase/tests/*_rls.sql` fixtures insert into Supabase `auth.users` and set `request.jwt.claim.sub` to simulate authenticated identities. `bootstrap.sql` is a disposable CI-only substitute, not a production authentication implementation.

## Future migration work

1. Introduce a secure server/API layer for the replacement PostgreSQL solution. Browsers must never receive PostgreSQL credentials. Replace the bodies of the vehicle and maintenance service functions with API calls while retaining their current signatures, payload allowlists and error behavior.
2. Replace the authentication adapter behind the existing contract. Implement email confirmation, password login, Google callbacks, secure session persistence/refresh and logout, and authenticated server-side user verification. Reconfigure environment variables and redirect URLs.
3. Migrate users and preserve or explicitly map UUIDs so vehicle ownership remains intact. Password hashes and OAuth identities require a provider-specific migration strategy; never export them into this public repository.
4. Replace the `auth.users` foreign key, `auth.uid()` defaults/predicates and role grants through reviewed migrations. If retaining RLS, set the authenticated identity transaction-locally from a server-verified session, using a database role that does not bypass RLS. Never trust a client-supplied owner ID or freely selectable identity claim. Handle pooled-connection identity isolation.
5. Preserve database constraints, indexes, triggers and owner isolation. Replace PostgREST-specific nested template selection, filtering, returned-row handling and error codes inside the services. Update CLI migrations, database verification tests, CI auth bootstrap and deployment documentation for the replacement platform.
6. Run owner CRUD, cross-owner read/write denials, protected-catalog, anonymous-access, validation and cleanup tests against the new API and actual PostgreSQL roles before switching traffic. Also test browser registration, confirmations, Google login and persisted sessions.

Existing deployed migrations are preserved. No remote policies, identity functions or data have been changed by this architecture refactor.
