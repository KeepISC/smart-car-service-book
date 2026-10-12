# Firebase Authentication migration (local preparation)

## Current state

The local [trusted provisioning service](trusted-provisioning.md) automatically provisions verified new Firebase UIDs without administrator approval. Use that guide for runtime credentials, hosting, restricted database login, legacy mappings and retries. The browser invokes provisioning before publishing a session and signs out after setup failure. No remote settings or migrations have changed.

The frontend now uses the official modular Firebase SDK for email/password registration, verified-email login, Google popup login, token events, local session persistence and logout. All operations stay in `src/services/auth.ts` behind `authService`. React consumes application UUID identities, not Firebase objects or tokens. Facebook/Apple remain unimplemented.

Supabase remains the database client. `src/services/supabase.ts` uses its official `accessToken` callback to request the current Firebase ID token; Supabase Auth methods and stored Supabase sessions are no longer used by this client. See [Supabase Firebase integration](https://supabase.com/docs/guides/auth/third-party/firebase-auth).

**This is not a completed remote cutover.** Firebase configuration, trusted provisioning, the third-party integration and the identity migration must be approved/configured before the local frontend can access a garage. Existing remote Supabase Auth settings and deployed migrations have not been changed. `.env.local` values were not overwritten.

## Console configuration

1. Firebase Console → Project settings → General → Your apps: register a web app and copy the SDK configuration into `.env.local`: `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`. These web identifiers are public configuration, not Admin credentials. Use one explicitly selected Firebase project. Restart Vite.
2. Firebase Console → Authentication → Sign-in method: enable Email/Password and Google, configure the Google support email. Authentication → Settings → Authorized domains: add the development hostname (`localhost`, explicitly when required) and production host. Review email verification templates and allow the return URL used by the frontend (`<app-origin>/login`). Google uses a popup; Firebase handles its callback on the configured auth domain.
3. Supabase Dashboard → Authentication → Third-Party Auth: add Firebase with the **same** Firebase project ID. Keep existing Supabase authentication configuration until cutover and rollback testing are approved. No JWT signing secrets need to be exported to the frontend.
4. Review and approve `202610110002_firebase_identity.sql` before applying. Configure `app_private.firebase_config` with the one approved project ID using a privileged, reviewed query. This table starts empty so Firebase access fails closed until explicitly configured. The Firebase project must match console integration, frontend env and this database configuration. Never change it after provisioning without a separately reviewed migration.

## Ownership and preservation

Existing `vehicles.owner_id` UUIDs and all vehicle/maintenance IDs remain unchanged. The migration copies existing Supabase user UUIDs into `app_private.app_users`, then replaces only the owner foreign key target and owner identity predicates/default. Maintenance relationships still reference vehicle UUIDs. No vehicles, maintenance items or Supabase user rows are deleted or reassigned; RLS stays enabled/forced throughout the transactional migration.

Firebase UIDs can be non-UUID strings. `app_private.firebase_identities` maps the approved project's Firebase UID to exactly one application UUID; an application UUID has at most one Firebase UID, with multiple providers linked to that Firebase user. The private schema has no frontend table grants and enforced RLS. The narrowly scoped security-definer `current_app_owner()` uses a fixed empty search path and reads only the configuration/mapping tables. Its trusted owner must retain the database privileges needed to read those private tables; never grant users mapping write access or BYPASSRLS.

RLS requires the configured issuer/audience, verified email, role and a UID-to-owner mapping matching the signed owner claim. The frontend's claim checks are readiness/UX checks, not signature verification or authorization. Supabase's third-party gateway verifies JWT signatures, expiration and issuer before PostgreSQL runs RLS. Wrong projects, missing mappings and fabricated claims fail closed.

Existing Supabase sessions remain compatible through a separate JWT branch (`aud = authenticated`, expected Supabase issuer shape, UUID subject); they are still verified against the actual Supabase project by its gateway. Legacy users present when the migration runs are preserved. Future legacy Supabase signups would need trusted registry synchronization and are not part of the Firebase cutover. Deleting Supabase Auth users no longer automatically deletes vehicles after the foreign-key change; implement an explicitly authorized account-deletion workflow against application owners later.

## Trusted provisioning and custom claims

Required Firebase custom claims:

```json
{ "role": "authenticated", "app_owner_id": "<canonical-application-uuid>" }
```

`role` is required by Supabase's integration. `app_owner_id` preserves the existing UUID ownership contract. Firebase supplies `sub`, `iss`, `aud` and `email_verified`; do not invent or overwrite those reserved claims. Claims must be set with the Firebase Admin SDK in a privileged server environment, never by the browser. See [Firebase custom claims](https://firebase.google.com/docs/auth/admin/custom-claims).

Provisioning order for a trusted backend/administrator:

1. Verify the Firebase account and exact project. For existing owners, prove control of the previous account or perform a reviewed administrative mapping. Do not match accounts automatically by email; Google/Apple email changes or collisions must not transfer vehicles.
2. For an existing owner, use its preserved UUID. For a genuinely new owner, create an application UUID in `app_private.app_users`. Insert the Firebase UID mapping in a database transaction with uniqueness checks. Never accept an owner UUID selected by the frontend. Use parameterized SQL and server-side credentials stored outside the repository.
3. Use Admin `getUser(uid)` and `setCustomUserClaims(uid, { ...existingClaims, role: 'authenticated', app_owner_id: canonicalUuid })`, preserving unrelated claims. Keep provisioning idempotent; commit the database mapping before assigning claims. If assigning claims fails, retry the same mapping rather than create another owner. Never assign a service/admin database role to a user.
4. Refresh the Firebase ID token after claims are assigned (`getIdToken(true)`/sign in again). The client refreshes claims at login; unprovisioned accounts see a setup error and cannot access database records. Registration sends email verification and signs out until verification. A new user registered in Firebase still needs trusted provisioning.

The Node service implements provisioning locally; hosting and credentials remain a manual deployment step. Ordinary verified users receive new owners automatically. Only legacy owner association requires independent proof and a private mapping prepared before first login. The database function commits the stable mapping atomically, then the service assigns claims; retries return the same owner. No Firebase onCreate/blocking function is deployed. Firebase Admin dependencies are imported only by `server/`, and no credential material is bundled into the frontend.

## Rollout, tests and rollback

Back up the remote database through a private approved process. Inventory owner UUIDs and plan/import Firebase accounts and credentials using a separately approved secure workflow. Password hashes are not automatically migrated; use a validated supported import or a password-reset process. Never put account exports in this public repository.

Before cutover, test with fictional accounts: registration/email verification, Google login, refresh persistence, logout, token renewal, claim propagation, provider linking UID stability, missing mapping, wrong Firebase project and cross-owner direct API attempts. Verify existing vehicles and maintenance remain attached to the preserved owner UUIDs. `firebase_rls.sql` tests PostgreSQL authorization with simulated claims on disposable CI PostgreSQL; it cannot verify real JWT signatures. It runs after the prior migration/RLS tests in CI. Live tests and remote migration application remain pending approval/configuration.

Rollback before removing legacy auth: redeploy the previous Supabase-auth frontend; preserved existing identities continue to access their UUID-owned records through the coexistence policy. Do not drop the application registry/mapping or restore the old foreign key without checking newly created Firebase-owned data. Do not reset data or disable RLS.

## Billing

Google and email/password login do not require Firestore, Firebase Storage, Firebase Hosting or phone/SMS services. Base Firebase Authentication has a no-cost offering; Identity Platform introduces quotas and MAU-based billing beyond its allowance. Review [Firebase pricing](https://firebase.google.com/pricing) and [Identity Platform pricing](https://cloud.google.com/identity-platform/pricing).

Deploying provisioning on Cloud Functions requires the Blaze plan/billing account; usage may fall within allowances but costs are possible. Blocking auth functions additionally require Identity Platform. A trusted provisioning process on an existing server avoids requiring Firebase Cloud Functions; do not enable a paid product automatically. Supabase database and third-party-auth costs remain subject to the existing Supabase plan.
