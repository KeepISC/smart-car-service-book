# Local provisioning setup and diagnosis

## Diagnosis on 11 October 2026

Google authentication and application provisioning are separate. The browser calls `VITE_FIREBASE_PROVISIONING_URL`, not `VITE_PROVISIONING_URL`. The local endpoint is configured, but port 8787 is unreachable. The restricted database URL is still a placeholder, and the configured Firebase Admin credential and database CA files do not exist.

Read-only remote checks confirmed that `202610110002_firebase_identity.sql` **is applied** to `ttwlscydylnaogawmgce`. The database stores `smart-car-service-book-61a9d` as its Firebase project. All four private tables, both identity functions, the restricted `scsb_provisioner` group role and the expected owner policies exist. RLS is enabled and forced on all eight application/private tables. There are no legacy users, vehicles or maintenance records, so no legacy mappings are required currently. The group role has no login, elevated attributes, inherited roles, schema creation or direct table/column privileges. A dedicated runtime login has not been created.

The local URL is `http://127.0.0.1:8787/provision`. Valid frontend values are preserved. Keep the credential JSON, certificate and populated server environment file outside the repository. No additional migration is needed. Runtime readiness remains blocked on credentials and separate approval to create the restricted login.

## Complete these steps in order

1. Confirm the applied migration and stored project with read-only checks before reconnecting a changed environment. Do not reapply the migration, reset the database or run test fixtures remotely.
2. Obtain separate approval for the restricted-login SQL below. Its password must be assigned through a private interactive administration connection. Retain trusted database-owner ownership of the security-definer functions.
3. If preserving a legacy account's access, prove control and prepare its explicit UID-to-existing-owner association before first Firebase login. Never associate by email. Ordinary new verified users require no approval rows: provisioning creates an enabled control row and a new owner automatically. Disabled rows and established mappings are never overwritten.
4. Obtain Firebase Admin credentials and the database CA using the instructions below. Never put either private credentials or a database password in any `VITE_` variable.
5. Copy `server/.env.example` to `C:/private/scsb/provisioning.env` (or another private folder outside this repository) and fill it locally. Do not copy credential contents into chat. Use absolute paths; dotenv does not expand `$env:USERPROFILE` or other variables inside values.

   ```dotenv
   FIREBASE_PROJECT_ID=smart-car-service-book-61a9d
   GOOGLE_APPLICATION_CREDENTIALS=C:/private/scsb/firebase-admin.json
   PROVISIONING_DATABASE_URL=REPLACE_ME
   PROVISIONING_DATABASE_CA_FILE=C:/private/scsb/supabase-root.crt
   PROVISIONING_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
   PORT=8787
   ```

   Use the dedicated PostgreSQL login, not the Supabase API key. URL-encode credentials where needed. Do not add `sslmode`/`sslcert` or other SSL URL parameters; the server validates the supplied CA and rejects certificate errors. Do not configure the Firebase Auth emulator for this trusted service.

6. First run the read-only credential/connection check, then start the server in one terminal at the repository root:

   ```powershell
   node --env-file=C:/private/scsb/provisioning.env server/check-readiness.mjs
   node --env-file=C:/private/scsb/provisioning.env server/index.mjs
   ```

   It binds to `127.0.0.1:8787`. Missing or placeholder configuration intentionally prevents startup. In a second terminal, start Vite on the exact allowed origin:

   ```powershell
   npm.cmd run dev:local
   ```

   This uses `http://localhost:5173` and fails if that port is occupied rather than silently selecting an origin not allowed by CORS.

7. Run `node --env-file=C:/private/scsb/provisioning.env scripts/check-provisioning.mjs`. It checks environment presence, project agreement, credential/certificate file existence, endpoint reachability, CORS, unauthenticated rejection and invalid fictional-token rejection without printing values or sending user tokens. An OPTIONS `/provision` should return 204 with the exact origin. POST without a bearer token or with the invalid fictional token should return 401. There is no GET health endpoint; GET `/provision` returns 405 and other paths return 404. Credentials must not be sent as a request body.
8. The operator reports that Supabase's Firebase third-party integration is configured. Confirm its project ID visually in the dashboard before first login; this setting could not be independently read with accessible credentials. The local `supabase/config.toml` has the integration disabled and describes the local Supabase stack, not the linked remote setting. Do not push local config. Keep the current Firebase Google/provider configuration and authorized localhost domain; request approval before changing settings if anything is missing.
9. Sign in through the browser. Server verification checks signature, issuer/audience, expiry, revocation, disabled status and verified email. Database mapping commits before Admin assigns `role: authenticated` and `app_owner_id`. The browser forces a new ID token before exposing a garage session. On setup failure it clears that Firebase session. Test first login, retry, returning login, logout and isolation using fictional accounts.

## Distinguish failures

| Stage                           | Evidence and action                                                                                                                                                                             |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Missing frontend configuration  | No `/provision` network request; error names the missing endpoint. Set `VITE_FIREBASE_PROVISIONING_URL`, then restart Vite.                                                                     |
| Server unavailable or CORS      | Failed fetch/preflight. Start the server; match the exact origin and port. Browsers deliberately do not distinguish CORS from network failures in fetch errors.                                 |
| Invalid identity                | HTTP 401. Check verification, token expiry/revocation and Firebase project agreement.                                                                                                           |
| Firebase Admin failure          | Credential loading can fail at startup. API/IAM/claim-assignment failures can produce 503. File existence alone does not establish credential validity or permissions.                          |
| Missing database migration      | Read migration history and schema metadata. Missing functions/tables cause setup failure even when Firebase login works. Apply only after approval.                                             |
| Database connection/permissions | TLS, login, grants or security-definer ownership can cause rejection. Check the dedicated server login and migration ownership. HTTP status alone does not identify the SQL cause.              |
| Account access denied           | HTTP 403 can mean disabled control row, conflicting claims, wrong configured project, duplicate legacy association or permission rejection. Do not alter ownership or disable RLS to repair it. |
| Provisioned but database denied | Confirm refreshed claims, matching third-party integration and owner mapping. RLS must still deny cross-owner access.                                                                           |

Responses never expose SQL/SDK diagnostics, credentials or ownership data. Client messages describe fixed failure categories. A successful response must include `provisioned: true`; a proxy returning an HTML page with HTTP 200 is rejected. See [trusted provisioning](trusted-provisioning.md) for production hosting and cost limitations.

## Obtain Firebase Admin credentials manually

Select `smart-car-service-book-61a9d` in Firebase Console, open Project settings → Service accounts → Firebase Admin SDK, and inspect the selected service account. If you already have a suitable key, reuse it. Otherwise, use Generate new private key yourself and save the download directly as `C:/private/scsb/firebase-admin.json`. This agent does not generate keys. Restrict local file access to your account.

For a dedicated service account, ask your Google Cloud administrator to grant a custom project IAM role containing `firebaseauth.users.get` and `firebaseauth.users.update`. These are the user-read and user-update permissions used for revocation checks and custom claims. This service does not need project Owner/Editor. Creating a service account, key or IAM role is a manual remote administration action. See [Firebase Admin setup](https://firebase.google.com/docs/admin/setup) and [Firebase Authentication IAM permissions](https://docs.cloud.google.com/iam/docs/roles-permissions/firebaseauth).

The server uses `applicationDefault()` with the explicit Firebase project ID. Loading a JSON file or initializing an SDK object does not prove API permissions. `server/check-readiness.mjs` authenticates the credential and looks up a random fictional UID to check user-read access; it never lists users or changes claims. Claim-write access still needs a controlled fictional-account login test.

## Proposed restricted-login SQL — approval required

This is a reviewed proposal for project `ttwlscydylnaogawmgce`, not an applied operation. It creates a passwordless role initially, so it cannot authenticate by password until the operator sets one privately. If the name already exists, stop and inspect it; do not replace or elevate it.

```sql
begin;
create role scsb_provisioning_local
  login inherit nosuperuser nocreatedb nocreaterole
  noreplication nobypassrls connection limit 5;
grant scsb_provisioner to scsb_provisioning_local
  with inherit true, set true;
grant connect on database postgres to scsb_provisioning_local;
alter role scsb_provisioning_local set search_path = '';
commit;
```

There are no direct table, approval, schema CREATE or elevated-role grants. The login inherits only the private schema USAGE and provisioning-function EXECUTE supplied by `scsb_provisioner`. PostgreSQL PUBLIC permissions still apply; the runtime checker verifies effective application data access and role attributes rather than relying only on the grant list. Do not grant membership to the Management API query session to work around its previous `SET ROLE scsb_provisioner` denial.

After this operation is approved and applied, use a private administrator `psql` session and run `\password scsb_provisioning_local`. Enter a strong password from your password manager at its hidden prompts. Do not send it to the agent or put it in SQL files, shell history or the dashboard SQL editor. `\password` is a psql command, not SQL. An existing administrator connection is needed; do not reset the project's administrator password. See [Supabase roles](https://supabase.com/docs/guides/database/postgres/roles).

## Obtain PostgreSQL host and trusted CA

Open project `ttwlscydylnaogawmgce` in Supabase Dashboard. In Connect, copy the **Session pooler** hostname and port (5432); use username `scsb_provisioning_local.ttwlscydylnaogawmgce` and database `postgres`. Copy the actual hostname rather than inferring it from the region. Session pooling supports IPv4. A direct connection uses hostname `db.ttwlscydylnaogawmgce.supabase.co`, port 5432 and username `scsb_provisioning_local`, and may require IPv6 availability. See [Supabase connection modes](https://supabase.com/docs/guides/database/connecting-to-postgres).

In Database Settings → SSL Configuration, download the database root CA certificate and save it as `C:/private/scsb/supabase-root.crt`. Downloading the certificate does not require changing SSL enforcement or restarting the database. See [Supabase SSL certificate instructions](https://supabase.com/docs/guides/platform/ssl-enforcement).

Set the populated environment file's `PROVISIONING_DATABASE_URL` to this pattern, replacing the password and dashboard hostname privately:

```text
postgresql://scsb_provisioning_local.ttwlscydylnaogawmgce:URL_ENCODED_PASSWORD@SESSION_POOLER_HOST:5432/postgres
```

URL-encode the password component when it contains reserved characters. Use the restricted role's password, not the administrator password or an API key. Do not include `sslmode`, `sslrootcert`, `sslcert` or other SSL URL parameters: the service supplies `ssl.ca` and `rejectUnauthorized: true` directly, preventing URL parameters from overriding certificate verification. Never set `NODE_TLS_REJECT_UNAUTHORIZED=0`.

## First successful Google login and verification limits

After the credential/connection check passes, start both processes as above. Ensure root `.env.local` contains `VITE_FIREBASE_PROVISIONING_URL=http://127.0.0.1:8787/provision` and the existing Firebase web configuration for `smart-car-service-book-61a9d`; restart Vite after editing. This is the only browser provisioning variable. The allowed origins are exactly `http://localhost:5173` and `http://127.0.0.1:5173`.

Sign in using a dedicated fictional test account with Google. The browser calls `/provision`; the server verifies its Firebase ID token, creates one UUID mapping automatically and assigns `role: authenticated` and `app_owner_id`. The browser refreshes its ID token, then Supabase validates it and RLS resolves the owner. No administrator admission approval is required for a new verified user. Never log or paste bearer tokens, credential JSON or account exports.

Verify a 200 response with `provisioned: true`, the refreshed claims using a local boolean check without printing the token, and a garage query through the application's Supabase client. Test logout/login and retry without allocating a second UUID. Use two fictional accounts for live owner-isolation testing and fictional vehicle data only. Disposable SQL authorization tests establish RLS behavior; simulated claims do not prove live JWT signatures or claim-write IAM permissions.

The runtime credential checker makes no record or claim changes. It verifies authentication, Firebase user-read API access, trusted-TLS PostgreSQL connectivity and effective login restrictions. Endpoint checks use no valid user token. The service's listening message alone does not establish a working database connection, because its PostgreSQL pool connects lazily.

Disposable CI fixtures override the seeded Firebase project inside rolled-back transactions. The concurrency test temporarily switches and restores only the disposable database project; never run these fixtures against the remote project.
