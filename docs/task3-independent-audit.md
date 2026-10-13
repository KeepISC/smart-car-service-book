# Task 3 independent audit — 12 October 2026

Current status: this is a historical audit record. The approved migration and authorized live integration/CRUD acceptance subsequently passed; see the [13 October final verification](task3-final-verification.md). Its publication verdict supersedes the historical recommendations below, while retaining their stated test limitations.

Follow-up: the [pre-deployment verification](task3-predeployment-verification.md) executed PostgreSQL 17 tests, found and fixed an additional schedule-deletion deadlock, and verified legacy-client compatibility through the migration's narrow grants and completion guard. This corrects the initial audit's bridge requirement; a separate bridge is not needed solely for ordinary old-client schedule edits. Its **NO-GO deployment recommendation** supersedes this initial audit's readiness verdict. The results below record the original audit scope and evidence.

Verdict: **PASS WITH CONDITIONS**. Database authorization and concurrency tests actually passed on an isolated workspace PostgreSQL 18.4 instance. Browser tests use mocked service modules: production-style browser/API/authentication integration is **NOT VERIFIED**. No deployment is recommended until that integration is exercised in a disposable Supabase environment. No remote migrations, production configuration changes, commits, pushes or deployments were performed.

## Scope and findings

Compared the working tree with the locally available `origin/main`, including every Task 3 untracked source, migration and test file. The remote ref was not fetched. Reviewed service boundaries, stable owner resolution, table/RPC grants, forced RLS, schema-qualified SECURITY DEFINER functions with empty search paths, transaction rollback, mileage consistency, completion ordering and fallback, overrides, state handling, forms, CSS and dependency changes.

| Severity | Finding                                                                                                                                    | Resolution and evidence                                                                                                                                                                                                                                                    |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CRITICAL | None identified within the reviewed scope.                                                                                                 | This is not a claim that deployed gateway configuration was tested.                                                                                                                                                                                                        |
| HIGH     | A vehicle row lock alone allowed an older transaction snapshot to miss a committed service visit and lower the odometer below its mileage. | Reproduced with the original concurrency script: both incompatible writes committed. The save RPC now creates a vehicle row version before modifying history. All 12 insert/edit races pass across both write orders and READ COMMITTED, REPEATABLE READ and SERIALIZABLE. |
| MEDIUM   | Maintenance schedule edits replaced derived service completions and overrides with the raw legacy baseline returned by the write.          | Reload the derived schedule after saving. Regression test verifies the service-derived 27,000 km due mileage remains displayed.                                                                                                                                            |
| MEDIUM   | Unpaginated history queries could omit older visits, including the only linked completion for a schedule, at the API row cap.              | Added deterministic 500-row pagination shared by timeline and maintenance loads; regression verifies a linked operation on page two is retained.                                                                                                                           |
| MEDIUM   | Service History SQL tests contained bare function statements that are invalid PL/pgSQL.                                                    | Replaced with PERFORM; executed the complete suite successfully.                                                                                                                                                                                                           |
| MEDIUM   | SQL accepted non-finite/presentation-incompatible dates through the RPC.                                                                   | Enforced YYYY-MM-DD input and a finite AD date range; SQL regression rejects `-infinity`.                                                                                                                                                                                  |
| LOW      | Overview and Service history were simultaneously marked active/pressed.                                                                    | Fixed the Overview condition; regression and browser assertions verify selection.                                                                                                                                                                                          |
| LOW      | A user-facing load error exposed migration instructions.                                                                                   | Replaced with ordinary retry guidance.                                                                                                                                                                                                                                     |
| LOW      | Production build reports a JavaScript chunk larger than 500 kB.                                                                            | Unchanged advisory; unrelated bundle refactoring deferred.                                                                                                                                                                                                                 |

## Database verification

The installed PostgreSQL 18 `share` directory contains only `i18n`, with no `postgres.bki`. No existing PostgreSQL service or Docker executable was found during diagnostics. Installed separate embedded PostgreSQL tooling under ignored `.tmp/postgres-tools`, initialized unique workspace data directories, bound the disposable server to loopback, and stopped each instance after testing. No PostgreSQL reinstall or system-wide configuration changes were made.

Applied migrations in this exact order:

1. `202610100001_create_vehicles.sql`
2. `202610110001_maintenance_schedules.sql`
3. `202610110002_firebase_identity.sql`
4. `202610120001_vehicle_maintenance_consistency.sql`
5. **`202610120002_service_history.sql`**

Executed the bootstrap and existing vehicle, maintenance, Firebase provisioning/RLS, and mileage-consistency SQL suites at their appropriate migration stages, then the Service History migration setup, preservation, RLS and legacy-compatibility suites. Tests cover forced RLS, cross-owner reads/writes, prohibited direct table mutations, rejection of conflicting completion changes after history is linked, anonymous and provisioner RPC denial, workshop/DIY CRUD, multiple operations, optional costs, interval override storage, invalid dates/mileage, cross-vehicle schedule references, edit rollback, missing visit deletion, and preservation of operation snapshots after schedule deletion.

The full vehicle and maintenance row JSON snapshots before and after the Service History migration were exactly equal. Preservation fixtures include known and not-applicable maintenance baselines. Service writes, edits and deletion leave those stored baselines and permanent intervals intact. Final cleanup query returned **0 vehicles, 0 visits, 0 operations**; the concurrency scripts also remove their owner/identity/approval fixtures and restore their fictional project configuration. The disposable database was dropped, its server stopped, and this audit's cluster directories removed, including those from earlier failed test attempts.

Concurrency results:

- **PASS:** 12 authenticated service insert/edit versus odometer races, both write orders, three isolation levels.
- **PASS:** 12 authenticated maintenance insert/edit versus odometer races, both write orders, three isolation levels. The follow-up runner also passed these races after the Service History migration; ordinary schedule edits remain compatible with legacy column grants.
- **PASS:** eight simultaneous provisioning requests produce one stable owner/mapping.

Parent vehicle serialization and automatic PostgreSQL rollback were executed, not merely inferred. More complex arbitrary multi-vehicle or schedule-deletion deadlock interleavings were not exhaustively stress-tested. SECURITY DEFINER ownership/search path safety was reviewed; the tests execute migrations as the disposable administrator and callers as authenticated/anonymous/provisioner roles. Real Supabase gateway token verification and deployed function ownership remain outside this local test environment.

## Frontend and browser verification

- **PASS:** 205 automated tests across 25 files, including the added pagination, maintenance edit, supported date range and tab-selection regressions. Completion tests cover historical baselines, mileage-only baselines, same-day mileage ties, deletion fallback, not-applicable baseline restoration and one-time interval overrides. Completion ordering is computed in TypeScript, so these are unit results, not SQL-derived ordering claims.
- **PASS:** headless Microsoft Edge fixture tests at **320, 375, 390, 768, 1024 and 1440 px**, with light, dark, system-light and system-dark styling (24 combinations).
- Browser coverage includes empty history, DIY/workshop form switching, selected and custom operations, overrides, save/edit/delete interactions, associated input labels, maintenance display and add-operation form, vehicle overview, garage, vehicle edit/save and new-vehicle form, and horizontal-overflow checks. Fictional fixture service modules replace the application service modules; these tests do not execute the Supabase SDK or production authentication. The harness renders the actual page components without the full authenticated application shell; new-vehicle route navigation is triggered programmatically where the standalone garage hides its desktop CTA on mobile.
- **NOT VERIFIED:** browser-to-PostgREST RPC CRUD, JWT refresh/recovery during history mutations, a deployed Supabase schema cache, real provider credentials or production grants.
- Accessibility verification covers associated labels, semantic controls, selected-section state and browser interaction. It is not a full screen-reader/WCAG certification.
- Pagination avoids the ordinary API row cap; it does not provide a database snapshot across multiple browser requests during simultaneous changes.

Local screenshots and machine-readable browser results are under ignored `.tmp/task3-browser-results`. The disposable database runner and browser fixture harness are `.tmp/task3-database.mjs` and `.tmp/task3-browser.mjs`.

## Quality and security checks

ESLint, Prettier, the complete automated test suite, production build, source secret scanner, and npm dependency audit passed independently. The dependency audit reported **0 vulnerabilities**. Gitleaks scanned tracked and untracked publishable source and all eight available Git commits with redacted output and found no leaks. Temporary tool distributions and private ignored environment files were excluded from the publishable-source scan. No application dependencies or lockfile changes were introduced by the audit.

## Audit-specific changed files

- `supabase/migrations/202610120002_service_history.sql`
- `supabase/tests/service_history_rls.sql`
- `scripts/test-service-history-concurrency.mjs`
- `src/components/MaintenancePanel.tsx`
- `src/components/ServiceHistoryPanel.tsx`
- `src/components/MaintenancePanel.serviceHistory.test.tsx` (new)
- `src/pages/VehicleDetails.tsx`
- `src/pages/VehicleDetails.test.tsx` (new)
- `src/services/maintenance.ts`
- `src/services/serviceHistory.ts`
- `src/services/serviceHistory.test.ts`
- `src/services/serviceHistoryLogic.ts`
- `src/services/serviceHistoryLogic.test.ts`
- `docs/task3-independent-audit.md` (new)

The remaining original Copilot changes were reviewed but retained. Ignored `.tmp` contains audit tools, disposable data, fixture harnesses, scanner reports and screenshots; these are not publication artifacts.

## Deployment considerations and remaining conditions

The new migration is forward-only and must follow `202610120001_vehicle_maintenance_consistency.sql`; earlier migrations were not edited. It creates history tables, installs guards/RPCs, and revokes direct completion updates. It locks vehicles and maintenance tables during installation but does not rewrite existing application records. The revised save RPC intentionally updates the parent vehicle row with its existing mileage to invalidate old snapshots; the existing updated-at trigger runs during a successful service save.

The frontend requires the new schema: without it, both history and maintenance loads fail. Coordinate the explicitly authorized migration and frontend release in a suitable window, verify privileged function ownership and schema cache visibility, and run disposable Supabase browser/API integration first. PostgreSQL serialization failures require a user retry; mutations are not automatically retried, avoiding duplicate visits after ambiguous network failures. The current UI routes completion changes through Service History and no longer offers direct legacy-completion editing.

No confirmed security or correctness finding listed above remains unfixed. The browser/API integration gap, deployed provider/grant assumptions, PostgreSQL 17 CI execution, exhaustive deadlock interleavings, and bundle advisory remain limitations. The verdict is conditional on that distinction; fixture browser success is not an end-to-end production readiness claim.
