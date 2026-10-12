# Project conventions

- Use 2-space indentation, descriptive names, single quotes and no semicolons in TypeScript/JavaScript. Run Prettier for formatting.
- Keep functions small. Comment security boundaries and complex business rules rather than obvious code.
- React consumes application types and `authService`. Keep Firebase and Supabase SDK calls in services; keep database queries in service modules.
- Application owner UUIDs are stable. Never infer ownership from email or accept frontend-selected owner IDs.
- Keep Firebase Admin and PostgreSQL credentials in the server environment only. No secrets, personal vehicle data or account exports belong in this public repository.
- Every user-data table must enforce RLS and owner isolation. Never disable RLS or apply remote migrations without explicit approval.
- Preserve existing vehicle and maintenance records. Provisioning must be transactional and idempotent.
- Test meaningful behavior, especially authorization, retries and authentication recovery. Run lint, tests, formatting checks, secret scanning and production build after changes.
- Do not deploy, commit, push or modify remote authentication settings without explicit authorization.
