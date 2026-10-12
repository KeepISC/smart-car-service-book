# Security audit — 12 October 2026

Overall status: **WARNING**. No privileged credential or personal-data exposure was found in the reviewed publication candidates. There are no indexed files and no commits; Git history is empty. This is a source-publication review, not approval to deploy or publish.

## Findings by severity

| Severity | Finding                                                                                                                                                                            | Disposition                                                                                                    |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| CRITICAL | No confirmed finding                                                                                                                                                               | No credential rotation or history rewrite identified as necessary                                              |
| HIGH     | Publication preflight omitted untracked initial-commit candidates; owner changes could retain mounted frontend data                                                                | Fixed candidate scanning and owner-keyed view resets, with regression coverage                                 |
| MEDIUM   | Named local credentials and environment examples needed publication protection; no process-level provisioning limits; disposable SQL fixtures conflicted with seeded configuration | Fixed ignore/index policy, placeholder examples, request/concurrency caps and disposable fixture configuration |
| MEDIUM   | Firebase revocation at provisioning is not applied on every direct Supabase request; live cross-owner verification remains incomplete                                              | Documented explicit application control-row suspension and legacy-session limits; no remote changes            |
| LOW      | CI actions used moving tags; security documentation described an obsolete pending migration                                                                                        | Pinned upstream action commits, added dependency monitoring/audit and updated documentation                    |
| LOW      | No root render-error boundary; CI PostgreSQL image remains a major-version tag; production hosting controls and repository settings remain manual                                  | Follow-ups, not discovered credential exposures                                                                |

## Git and secret scanning

- git check-ignore confirms populated environments, named Admin JSON, private key formats, credential directories, dumps, editor state, logs, temporary files and generated output are excluded. Both environment examples, ordinary JSON, legitimate certificates and migrations remain trackable.
- The three specified files under C:/private/scsb are outside the repository. Git cannot stage them in this repository at their current locations; named in-repository copies are covered by ignore rules and publication checks.
- Git's staging dry run lists only publication candidates. No files were staged. An empty index means there is no staged patch content; the preflight separately scans untracked/tracked candidates so this is not a false clean result.
- Gitleaks 8.30.1 scanned the working directory with fully redacted output. Three matches were public Firebase web configuration in ignored local/build files and a public Supabase publishable key in the ignored environment. No privileged secret was identified. These are not Firebase Admin credentials or a Supabase service-role key.
- Candidate scanning passed. Git history is empty, so history scanning is not applicable. Rerun index/history checks immediately before any separately authorized public push.
- Authored publication content contains code, fictional fixtures and documentation; no photos, account exports or personal vehicle records were identified. Automated scanning cannot guarantee future anonymity.

## Firebase

Admin SDK code and credentials stay server-side. ID tokens are verified with revocation checking; issuer, audience, UID/sub, expiry, verified email and current user status are checked before ownership is resolved. Browser-selected UUIDs and email-based ownership are not trusted. Failed preparation clears the active session without signing out a replacement account. Persisted sessions and refresh are SDK-managed. Stable mapping and custom claims were verified in the earlier controlled browser login; this audit does not independently inspect private account data.

Apple/Facebook linking is not implemented. Future linking must prove control and preserve UID/UUID; collisions must not silently merge owners. The provider-design document is historical planning, not authorization to enable providers.

## Supabase and PostgreSQL

All eight application/private tables in the migrations enable and force RLS. Vehicle policies isolate ownership; maintenance policies follow the parent vehicle. Catalog writes remain privileged, and only verified catalogs are readable by recognized identities. Column grants prevent ownership/system-column edits. The private provisioner function uses a fixed empty search path, qualified objects, a per-UID lock and uniqueness constraints. It is transactional, retries preserve mappings and conflicts roll back owner creation. SECURITY DEFINER ownership must remain trusted.

The server uses the restricted login with explicit CA/hostname verification; URL query parameters cannot override credentials or TLS. The readiness check previously confirmed effective role restrictions and no direct application-table access. No remote migrations, grants or RLS changes were made during this audit. Direct data requests rely on Supabase's verified JWT gateway; SQL fixtures simulate claims and are not signature-verification tests.

## Provisioning service

The listener remains 127.0.0.1-only. Origins are exact HTTPS origins with loopback HTTP allowed for development. The handler rejects wrong origins/paths/methods, request bodies and missing/invalid bearer tokens. Backend errors remain fixed and generic. The new process limits permit 60 token-bearing attempts per minute and four concurrent requests, releasing concurrency capacity even on failure. Production still requires HTTPS and per-client/distributed proxy controls; CORS is not authentication. No forwarded IP headers are trusted.

## Frontend

React escapes rendered values; no unsafe HTML execution sink was identified. Maintenance source links use HTTPS and noreferrer. SDK/database operations stay in services. Client validation is backed by database constraints and RLS. Owner-keyed layouts clear mounted user data on account changes, and vehicle-detail views reset on vehicle changes. Tokens/passwords are not logged by application code. A root rendering error boundary remains a resilience improvement, not an authorization mechanism.

## GitHub Actions

Workflows use contents: read, ordinary push/pull_request events and no privileged pull_request_target execution. Action revisions are pinned to verified upstream commit SHAs. Jobs have timeouts. CI includes lint, formatting, tests, build, source scanning, ignore validation, dependency audit, full-history Gitleaks and disposable PostgreSQL authorization/concurrency tests. The database password is explicitly fictional and used only by the disposable CI service.

Dependabot monitors npm and action updates weekly. Branch protection, required PR checks, secret scanning/push protection and private vulnerability reporting require manual repository administration; no settings were changed. See [GitHub secure-use guidance](https://docs.github.com/en/actions/reference/security/secure-use).

## Verification

| Check                                     | Result                                                                                                |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| ESLint                                    | PASS                                                                                                  |
| Prettier                                  | PASS                                                                                                  |
| Automated application/security tests      | PASS — 166 tests, 18 files                                                                            |
| Production build                          | PASS — existing bundle-size advisory remains                                                          |
| npm dependency audit                      | PASS — zero known vulnerabilities reported                                                            |
| Source secret scanner                     | PASS                                                                                                  |
| Gitleaks publication candidates           | PASS                                                                                                  |
| Complete working-directory Gitleaks scan  | WARNING — only expected public browser keys in ignored environment/build files                        |
| Index/history                             | Empty index; no commits/history                                                                       |
| Git ignore and staging dry-run validation | PASS                                                                                                  |
| Disposable SQL authorization suites       | PASS — vehicle, maintenance, Firebase provisioning and Firebase RLS using in-memory PostgreSQL        |
| Real PostgreSQL multi-session concurrency | NOT VERIFIED — installed PostgreSQL could not initialize a fresh local cluster; no server was started |
| Live CRUD/maintenance/cross-owner tests   | NOT VERIFIED — browser results remain outstanding                                                     |

The CI PostgreSQL job must establish multi-session concurrency before production rollout. Live testing must use two fictional accounts and cover cross-owner reads, updates/deletes and foreign-owner inserts. [Firebase session management](https://firebase.google.com/docs/auth/admin/manage-sessions) explains token lifetime and revocation; application control-row disabling is the implemented immediate Firebase-path denial boundary.

## Publication decision

**YES: the reviewed source snapshot is suitable for a public repository**, with no identified privileged secrets/personal content among publication candidates. This is not production-readiness approval. Rerun final staged-content/history scans and review before an explicitly authorized push. No staging, commit, push, deployment, history rewrite, credential rotation or remote configuration changes were performed.
