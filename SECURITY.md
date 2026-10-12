# Security

Firebase web configuration and Supabase publishable keys are public browser configuration. Firebase Admin, privileged API keys and PostgreSQL passwords are server-only secrets. Every VITE_ value reaches the browser. Keep populated environment files, Admin JSON, private keys and account/database exports outside this public repository.

## Authentication and authorization

Firebase Admin verifies token signature, issuer, audience, expiry and revocation on the server. Verified email and a currently enabled Firebase account are required. The browser supplies no trusted UID or owner ID. A restricted PostgreSQL function resolves the verified UID to a stable application UUID; it never merges accounts by email. Legacy mappings require independently proven control and separately approved administration.

Provisioning is transactional and idempotent. A per-UID lock serializes first requests; mapping uniqueness and rollback preserve existing owners and records. Claims are written after the mapping commits, so retries reuse the same UUID. Conflicting ownership/privileged claims fail closed. The browser refreshes its Firebase token before querying Supabase.

Supabase validates Firebase JWTs through its configured integration. RLS checks issuer/audience, verified email, signed role/owner claims, the private mapping and enabled control row. All eight application/private tables have enabled and forced RLS in the migrations. Verified catalogs are read-only to recognized users; maintenance is isolated through its parent vehicle. Ownership/system columns are not client-editable. Fixed-search-path SECURITY DEFINER functions must remain owned by a trusted database administrator, never the restricted runtime login. The runtime account has no direct application/private table access or elevated attributes.

The configured project's readiness and live browser login have passed. Disposable SQL tests do not prove remote JWT verification or live cross-owner isolation. Never reapply migrations, alter RLS or change remote settings as a diagnostic shortcut.

## Session revocation and linking

Provisioning uses verifyIdToken(token, true). Direct Supabase requests do not pass through this revocation check. Already issued Firebase ID tokens can remain usable until expiration unless the application's private access-control row is disabled. Immediate Firebase-path suspension requires an authorized operator to disable that row as well as disable/revoke Firebase access. Legacy Supabase sessions are a separate, explicitly approved cutover path. See [Firebase session management](https://firebase.google.com/docs/auth/admin/manage-sessions).

Google and email/password are implemented. Apple/Facebook linking is not implemented. Future linking must require recent reauthentication and control of both identities, preserve UID/owner UUID and reject collisions without merging by email. Do not move vehicle records during provider linking.

## Provisioning service and hosting

The service binds only to 127.0.0.1. Origins are exact HTTPS origins except local loopback development. Missing origins, untrusted origins, bodies and missing/invalid identities are rejected. CORS is not authentication: non-browser clients can forge an Origin header. SQL is parameterized. PostgreSQL certificate and hostname verification remain enabled with an explicit CA; URL parameters cannot override credentials or TLS. SDK/SQL diagnostics and tokens are never returned to clients or logged.

Token-bearing requests are limited to 60 attempts per minute and four concurrent requests per process. Saturation returns 429 with Retry-After. These limits reset on restart and do not replace per-client/distributed reverse-proxy limits. Production requires HTTPS, a trusted proxy, request limits, secret management and monitoring. Never trust forwarded IP headers without a reviewed proxy configuration. CSP/HSTS and hosting settings require a separate production review.

React renders text without unsafe HTML injection. Frontend validation supplements database constraints and RLS. Owner changes remount user-data views to clear cached account state. Use only trusted HTTPS maintenance source links with noreferrer. Firebase manages session persistence and renewal; application code does not store token copies. A root render-error boundary is not implemented; this is a resilience follow-up.

## Public repository release checks

1. Review every publication candidate and the complete available history for secrets, personal data and exports. Ignore rules do not remove tracked content. Do not add real account emails, plates, VINs, invoices, user photos or screenshots with personal information. Test fixtures must be fictional. Public project IDs and endpoint hostnames are not credentials.
2. Keep only placeholder .env.example and server/.env.example trackable. Ignore populated environment files, named Firebase Admin JSON, private key formats, local credential directories, backups, editor state, logs, temporary files, dependencies and build outputs. Arbitrarily named JSON/certificate/SQL files still require content review; legitimate resources are not blanket-ignored.
3. Install [Gitleaks](https://github.com/gitleaks/gitleaks) v8.19+ on PATH or set GITLEAKS_BINARY to its executable. Run npm run security:preflight before staging and after any authorized staging. It checks indexed paths, scans unignored candidates, staged changes and all available history. It stages nothing and fails closed on missing tooling or scan errors. Run node scripts/check-publication-ignore.mjs. No commits means there is no history to scan; an empty index does not skip candidate scanning.
4. Run lint, formatting checks, automated tests, production build, dependency audit and source secret scanning. The lightweight source scanner does not replace Gitleaks. Run authorization/concurrency fixtures only on disposable PostgreSQL, never a live project. Verify live CRUD and cross-owner read/write denial using two fictional accounts before production rollout.
5. If any real secret was committed, stop publication and obtain explicit approval for credential rotation and history repair. Ignore rules do not erase history. Never print secrets or use scanner allowlists to conceal an exposure. Public browser keys are distinct from Admin/service-role keys and database passwords.
6. Rerun the final index/history scans before an explicitly authorized public push. No audit automatically authorizes staging, committing, pushing or deploying.

GitHub Actions has read-only contents permission, pinned action commits, quality/security checks and disposable database tests. Dependabot monitors npm and actions weekly. The PostgreSQL CI image still uses a moving major tag. Configure branch protection, required PR checks, secret scanning/push protection and private vulnerability reporting manually where available; no repository settings are changed by this audit. Report vulnerabilities privately to the maintainer, never through issues containing personal data or credentials.
