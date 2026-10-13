# Smart Car Service Book — Project Instructions

## 1. Development Principles

- Prefer simple, readable, maintainable solutions over unnecessary complexity.
- Follow existing architecture, naming conventions and project patterns.
- Use 2-space indentation, descriptive names, single quotes and no semicolons in TypeScript/JavaScript.
- Use Prettier for formatting and ESLint for code quality.
- Keep functions small and focused.
- Comment security boundaries, concurrency decisions and complex business rules rather than obvious code.
- Avoid unrelated refactoring, unnecessary abstractions and new dependencies when existing functionality is sufficient.
- Preserve accessibility, responsive design and light/dark/system theme support.

## 2. Architecture

- Keep application types in the existing type modules.
- React components should handle presentation and interactions, not direct database operations.
- Use `authService` for authentication.
- Keep Firebase and Supabase SDK calls inside service modules.
- Keep database queries and RPC calls inside the existing service abstractions.
- Preserve the database access abstraction to allow future backend changes.
- Keep Firebase Authentication independent of Supabase Authentication.
- Maintain extensibility for additional authentication providers without implementing them unnecessarily.

## 3. Authentication and Security

- Application owner UUIDs must remain stable.
- Never infer ownership from email or accept frontend-selected owner IDs.
- Validate Firebase identity server-side.
- Keep Firebase Admin and PostgreSQL credentials in private server-side configuration.
- Never expose passwords, access tokens, private keys or connection strings.
- Never include secrets, personal vehicle data, account exports or private backups in this public repository.
- Use least-privileged database access.
- Every user-data table must enforce appropriate RLS and ownership isolation.
- Never bypass or weaken RLS to simplify development.
- Validate cross-owner references and database function permissions.
- Treat PostgreSQL `SECURITY DEFINER` functions, grants and authentication boundaries as security-sensitive.

## 4. Database and Data Integrity

- Use forward-only PostgreSQL migrations.
- Never modify migrations already applied remotely.
- Preserve existing vehicle, maintenance, service history and ownership records.
- Provisioning must remain transactional and idempotent.
- Related database mutations must be atomic.
- Enforce critical business constraints at database level, not only in the frontend.
- Preserve vehicle mileage consistency with recorded maintenance and Service History completions.
- Maintain consistent lock ordering for concurrent vehicle, maintenance and service updates.
- Handle constraint violations, serialization failures and transaction rollback correctly.
- Avoid conflicting sources of truth.

## 5. Maintenance and Service History

- Distinguish maintenance schedules from completed maintenance history.
- Service History supports workshop and DIY maintenance.
- A service visit may contain multiple operations.
- Keep permanent maintenance intervals separate from one-time completion overrides.
- Calculate upcoming maintenance from the latest applicable completion, preserving existing legacy baselines.
- Handle historical entries, editing and deletion without corrupting maintenance calculations.
- Preserve date-based and mileage-based intervals independently; whichever becomes due first applies.
- Preserve month-end and leap-year calculations.
- Do not introduce unnecessary oil catalogs, inventory systems or workshop directories.
- Keep Service History feature-flag behavior consistent with its documented rollout design.

## 6. Task Scope and Token Efficiency

- ChatGPT handles project planning, requirements and task decomposition.
- Focus on implementing the current requested task.
- Inspect only relevant files and dependencies, expanding when necessary.
- Prefer small tasks that can be completed in approximately 5–15 minutes.
- Avoid unnecessary repository-wide exploration.
- Reuse previously verified implementation patterns.
- Do not repeat completed audits or full test suites without a relevant reason.
- Run targeted tests during development.
- Run comprehensive verification for publication, migrations, security-sensitive changes or when explicitly requested.
- Never sacrifice correctness, security or data integrity to reduce token usage.
- If a task becomes too large, complete a safe, useful portion and report the remaining work.

## 7. Autonomous Local Development

- Perform authorized local development operations without unnecessary confirmation.
- Edit files, run local commands and execute relevant tests autonomously within the configured sandbox.
- Review the working tree before modifying an existing project.
- Preserve all pre-existing uncommitted changes.
- Never reset, revert, discard or overwrite unrelated work without explicit authorization.
- Never interpret automatic command approval as authorization for prohibited operations.
- Ask questions only when essential information or authorization is missing.

## 8. Testing and Verification

- Test meaningful behavior rather than only implementation details.
- Prioritize regression tests for authentication, authorization, ownership, concurrency and maintenance calculations.
- Test transaction rollback and retries when relevant.
- Use fictional data and disposable databases for database mutation tests.
- Never run destructive tests against live application records.
- Run applicable lint, formatting, tests, build and security checks according to task scope.
- Run comprehensive checks before authorized publication.
- Clearly distinguish PASS, FAIL and NOT VERIFIED.
- Do not claim browser, integration or security verification unless actually executed.

## 9. Git and Deployment Safety

- Never commit, push, merge, rebase, force-push or create releases without explicit authorization in the current task.
- Permission to commit does not imply permission to push.
- Stage only files related to the approved task.
- Review staged changes for secrets, private data and unrelated modifications before publication.
- Never deploy applications or apply remote migrations without explicit authorization.
- Never modify remote Firebase, Supabase, production data or cloud configuration without explicit authorization.
- Verify migration targets, checksums, backups and prerequisites before authorized remote changes.
- Stop and report unexpected deployment or database conditions rather than improvising repairs.

## 10. Documentation and Reporting

- Keep documentation accurate, practical and concise.
- Update documentation when architecture, behavior, configuration or recovery procedures change.
- Avoid rewriting documentation for trivial changes.
- Never include credentials, private backup contents or personal records in documentation.

For each task, report:

1. Changes made and files modified.
2. Tests executed and results.
3. Outstanding issues or blockers.

Keep reports concise unless detailed analysis is explicitly requested.

If interrupted, preserve existing changes and provide a checkpoint identifying completed work, remaining work and relevant files.

## 11. Project Workflow

- Implement features incrementally.
- Prefer existing service abstractions and UI patterns.
- Keep the application mobile-first and maintainable.
- Use Codex for focused implementation, with GitHub Copilot Free available for small tasks.
- Preserve verified functionality when adding features.
- Do not expand the current task into unrelated features.
- Do not commit, push, deploy or apply remote migrations unless explicitly authorized.