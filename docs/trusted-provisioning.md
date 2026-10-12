# Trusted Firebase provisioning

The browser signs in with Firebase, then calls the Node service at `VITE_FIREBASE_PROVISIONING_URL`. The service verifies an ID token with revocation checking and requires a currently enabled account with verified email. Its restricted PostgreSQL function automatically creates a new application owner for a new UID, without administrator approval. It assigns `role: authenticated` and `app_owner_id` with Firebase Admin, preserving unrelated claims. The browser refreshes its token before exposing an application session. Supabase validates the Firebase JWT; RLS checks the project, UID mapping, signed owner claim and enabled access-control row.

This is a local service, not a production deployment. The configured project has passed readiness and live browser login. Setting up another project still requires separately approved migrations and integration settings; never reapply a migration merely to diagnose a configured project.

## Firebase and Supabase setup

1. Select one Firebase project and register a web application. Put its public API key, auth domain, project ID and app ID into the root `.env.local`, using `.env.example`. Do not overwrite existing Supabase values. Restart Vite after changes.
2. Enable Email/Password and Google in Firebase Authentication. Set the Google support email. Add `localhost` and the exact production hostname to authorized domains. Review email verification templates and allow `<app-origin>/login` as the verification return URL. Registration sends verification and signs out; first verified login provisions automatically.
3. Configure Supabase Authentication → Third-Party Auth → Firebase with the same project ID. The frontend uses the official `accessToken` callback, not Supabase Auth login or token exchange. Keep legacy Supabase settings until separately approved cutover/rollback verification.
4. Review and separately approve `202610110002_firebase_identity.sql`. It preserves existing owner UUIDs and vehicle/maintenance relationships, creates private approval/mapping tables and a restricted provisioning function, and keeps RLS enabled/forced. For an already configured project, inspect migration history rather than reapplying this migration. A database owner must execute it so its fixed-search-path security-definer functions can read the forced-RLS private tables. Do not change function ownership to the restricted runtime login.
5. Privileged operators configure `app_private.firebase_config` with the exact project ID. Provisioning fails closed if it does not match. Never change the project after mapping users without a reviewed migration.

See [Supabase Firebase authentication](https://supabase.com/docs/guides/auth/third-party/firebase-auth), [Firebase token verification](https://firebase.google.com/docs/auth/admin/verify-id-tokens), and [Firebase custom claims](https://firebase.google.com/docs/auth/admin/custom-claims).

## Server credentials and local startup

Copy `server/.env.example` to a private directory outside the repository and populate its placeholders. Load it with Node's `--env-file` option. Ignored `server/.env.local` remains optional. Never share populated values or add them to Git. The checked-in database validator is scoped to this project's restricted login and endpoint formats; another project needs a reviewed local change.

- `FIREBASE_PROJECT_ID`: the same explicitly selected project.
- Firebase application-default credentials: prefer an attached workload identity in production. For local development, set `GOOGLE_APPLICATION_CREDENTIALS` to a Firebase Admin service-account file outside this repository. Restrict IAM permissions to the required Firebase Authentication user-read/update operations. No Admin key belongs in any `VITE_` variable.
- `PROVISIONING_DATABASE_URL`: a dedicated PostgreSQL LOGIN, with membership in `scsb_provisioner` only. Create the login and credential through a privileged private administration process; do not use `postgres`, Supabase API secret keys, privileged role memberships or BYPASSRLS. The migration's group role cannot log in itself. Do not grant the login direct table access, permission to approve users, or permission to create objects in `app_private`. Use a PostgreSQL connection, not PostgREST.
- `PROVISIONING_DATABASE_CA_FILE`: the trusted certificate authority file for that connection. Certificate verification is required; SSL URL parameters that could override verification are rejected. Credentials must be URL-encoded where necessary.
- `PROVISIONING_ALLOWED_ORIGINS`: comma-separated exact frontend origins, with no paths or trailing slash. HTTPS is required except loopback development origins.
- `PORT`: defaults to 8787. Run `npm run server:provisioning` on the trusted host. It binds to loopback; expose `/provision` through an HTTPS reverse proxy with request-rate and concurrency limits. Local development may use `http://127.0.0.1:8787/provision`.
- Root `VITE_FIREBASE_PROVISIONING_URL`: the public endpoint URL ending in `/provision`. It contains no credentials, query parameters or owner IDs.

The endpoint accepts POST with a Firebase ID token in `Authorization: Bearer …`, no body and no cookies. The server verifies signature, project, expiration and revocation. It rejects missing/foreign/unverified identity before touching ownership. Request bodies are rejected, so a browser cannot select a UID or UUID. Backend diagnostics are not returned or logged.

## Public registration and existing accounts

Ordinary verified users need no approval. The function automatically inserts an enabled row in the historically named `firebase_provisioning_approvals` table. This private table remains for legacy mapping and immediate access suspension, rather than admission approval. The runtime login cannot write it directly.

A privileged operator inserts a row into `app_private.firebase_provisioning_approvals` for the independently verified UID:

- **New owner:** no operator action is needed. A new UID receives a fresh UUID, even if its email matches a legacy account.
- **Existing owner:** prove control of the prior account or use an explicitly reviewed administrative migration. Set `existing_owner_id` to its preserved application UUID before allowing login. Never match by email or accept the UUID from a browser. Uniqueness prevents two Firebase UIDs owning the same application account.

Prepare legacy mapping rows before the user's first Firebase login using parameterized SQL through private administration tooling. Once a UID has a mapping, it cannot be reassigned by provisioning; late migrations require a separately reviewed repair. No Firebase onCreate function is needed. For bulk migration, securely import accounts or arrange password resets separately; do not put exports in this repository.

The provisioning function inserts the per-UID control row with `ON CONFLICT DO NOTHING`, then locks it before checking/creating its mapping. Concurrent first requests across server instances serialize before UUID allocation. Existing legacy mappings and disabled rows are never overwritten. Mapping and any new owner commit atomically in one database statement. Claims are assigned afterward; failures retry the same UUID. Conflicting live owner/privileged role claims fail closed for repair. Keep this service the single writer for ownership claims and coordinate any other custom-claim writers.

Set an approval's `enabled` to false to deny Firebase RLS access even to previously issued tokens and to deny new provisioning attempts. Also disable/revoke Firebase accounts when appropriate. Existing Supabase sessions remain a separate rollback path and must be retired or revoked explicitly during approved final cutover. Revoking Firebase approval does not revoke a legacy Supabase session.

Provider linking stays tied to one Firebase UID and application owner UUID. Facebook/Apple and linking UI are not implemented. Future linking must prove control, preserve UID/UUID and avoid email-based account merging.

## Validation before live use

Run lint, tests, formatting, secret scanning and build. CI runs migration/provisioning/RLS tests against disposable PostgreSQL 17. Local disposable tests do not establish real JWT signature acceptance by Supabase.

With fictional accounts, verify email verification, automatic first login, Google popup login, persisted sessions, token refresh, logout and recovery after service failure. Unverified users must be denied. Test concurrent first requests and claim-assignment retries. Verify preserved legacy records with an explicitly mapped owner, cross-owner denial and disabled access controls. Obtain separate approval before remote migration, configuration or deployment.

## Hosting and costs

Prefer running this small Node process on an existing trusted server with Node 24, a process supervisor and an HTTPS reverse proxy. It needs outbound access to Firebase Admin APIs and PostgreSQL with certificate verification. The listener is deliberately loopback-only. Static frontend hosting cannot run it. Reusing a server introduces no new subscription; CPU, traffic and existing hosting/database charges still apply. Apply per-client request-rate and concurrency limits at the proxy because verified public registrations can create owners. The process also caps token-bearing attempts at 60 per minute and four concurrent requests; saturation returns 429 with Retry-After. These caps do not replace distributed proxy controls.

An optional managed alternative is Cloud Run with request-based billing and zero minimum instances. The current loopback listener requires a container proxy listening on `0.0.0.0:$PORT`, or a separately reviewed listener adaptation. Cloud Run requires billing; its free allowance includes 2 million requests/month plus limited CPU and memory, shared across the billing account. Region, excess usage, egress, image storage and builds can incur charges, and cold starts affect first login. See [Cloud Run pricing](https://cloud.google.com/run/pricing). No managed hosting dependency was added.

Google and email/password auth do not require Firestore, Storage, phone/SMS, blocking functions or Cloud Functions. Firebase has a no-cost auth offering; email delivery and account creation have quotas. Identity Platform has separate active-user limits and pricing. Check [Firebase pricing](https://firebase.google.com/pricing) and [authentication limits](https://firebase.google.com/docs/auth/limits) before rollout. Supabase database and third-party-auth limits remain those of the selected plan. Free allowances are not a guarantee of zero total cost.
