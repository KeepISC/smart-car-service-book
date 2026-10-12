# Smart Car Service Book

**Firebase integration implemented locally; remote cutover pending:** authentication uses Firebase through `authService`. The separate [trusted provisioning service](docs/trusted-provisioning.md) verifies approved users, preserves stable owner UUIDs and assigns Firebase claims before database access. Follow its setup instructions and [Firebase migration and rollout](docs/firebase-migration.md) before live use. The identity migration has not been applied, and remote authentication settings remain unchanged.

See [Architecture and provider portability](docs/architecture.md) for the service/authentication boundaries and the Supabase-specific identity changes needed for a future PostgreSQL migration.

A mobile-first personal vehicle garage built with React, TypeScript, Vite, Tailwind CSS, React Router, Lucide and Supabase. Includes email/password registration and login, Google OAuth, persistent sessions, protected routes, vehicle CRUD, and light/dark/system themes.

Maintenance schedules support reviewed starter or verified templates, custom operations, and the last known completion date/mileage. Detailed service records, notifications and vehicle lookup remain outside scope.

## Maintenance schedules (Task 2)

The vehicle details page has Overview and Maintenance sections. New vehicles open Maintenance to review a matching verified template, an editable starter schedule, or a blank schedule. Catalog matching uses vehicle type, make, model, year range and engine. Each operation can be added, edited, disabled, re-enabled or removed. Draft schedules are not persisted until reviewed and saved.

Starter intervals are **illustrative examples, not verified manufacturer specifications**: oil/filter 20,000 km / 12 months, timing belt 120,000 km / 72 months, air filter 30,000 km / 24 months, brake fluid 24 months, coolant 60,000 km / 48 months. Confirm against official vehicle documentation. These examples live only in the frontend and are never inserted into the verified catalog.

The 11 October audit verified that `supabase/migrations/202610110001_maintenance_schedules.sql` is recorded as applied remotely. On a new database, apply it only after explicit approval. The migration adds `maintenance_templates`, `maintenance_template_items`, and `vehicle_maintenance_items`. Trusted administrators alone may populate catalog sources and mark templates verified after confirming applicability. Users can read only verified templates, and only manage maintenance items for their own vehicles. The migration contains no catalog seeds.

Calculations are in `src/services/maintenanceLogic.ts`. Next mileage uses the previous completion mileage; next date uses calendar months with month-end clamping. Either independent limit can make an item due. Due-soon thresholds are inclusive at 1,000 km and 30 calendar days. Unknown history never implies overdue; partial baselines remain unknown unless a known limit is due or approaching. Disabled and not applicable items do not produce due statuses. No estimated dates are inferred from kilometres. Completion dates cannot be in the future, and completion mileage cannot exceed current vehicle mileage.

The GitHub Actions database job executes both migrations and the rollback-based owner isolation tests on a disposable PostgreSQL 17 database. Its fictional password is only for that ephemeral CI service. `supabase/tests/bootstrap.sql` emulates minimal Supabase auth roles **for CI only; never run it on a Supabase project**. Database tests cover cross-owner reads/writes, anonymous denial, protected catalogs, immutable vehicle association and completion constraints. Live Supabase verification still requires approved migration application; SQL tests are not executed remotely automatically.

## Local setup

Use Node.js 24 LTS and npm. From this directory:

```sh
npm ci
cp .env.example .env.local
npm run dev
```

On Windows PowerShell, use `Copy-Item .env.example .env.local` and `npm.cmd` if script execution policy blocks `npm.ps1`. Configure the Supabase and Firebase variables below and restart Vite. Without Firebase configuration, sign-in is disabled. Database access also requires approved identity migration, third-party integration and trusted owner provisioning. No fictional vehicles are persisted automatically.

```dotenv
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_REPLACE_ME
VITE_FIREBASE_API_KEY=REPLACE_ME
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project
VITE_FIREBASE_APP_ID=REPLACE_ME
VITE_FIREBASE_PROVISIONING_URL=https://your-provisioning-host.example/provision
```

Use only the project publishable key from Supabase Settings → API keys. The frontend rejects legacy JWT and secret keys. Never put service-role keys, passwords or Google client secrets into a `VITE_` variable. See [SECURITY.md](SECURITY.md).

## Supabase database and Firebase configuration

1. Create a Supabase project. Run `supabase/migrations/202610100001_create_vehicles.sql` in its SQL editor, or link the Supabase CLI to the project and run `supabase db push`. Apply the migration once.
2. Follow [Firebase migration setup](docs/firebase-migration.md) to enable Google and Email/Password in Firebase, configure authorized domains and fill in public Firebase web configuration. Keep existing remote Supabase Auth settings for rollback until an approved cutover.
3. Configure Supabase Authentication → Third-Party Auth with the same Firebase project. No Supabase Auth login calls are used by this frontend.
4. Review the identity migration and approve its application separately. Configure the restricted server login and Firebase Admin application-default credentials as described in [trusted provisioning](docs/trusted-provisioning.md). Verified new users provision automatically without approval. Existing UUID ownership must be preserved through explicit administrator mappings prepared before first login; never match accounts automatically by email.
5. Restart Vite, register and verify an email, complete trusted account provisioning, and sign in before adding a vehicle.
6. Verify owner isolation: create a second account, confirm it cannot select, update or delete the first account’s vehicle, and cannot insert records with the first owner ID. Anonymous access must return no records/permission errors. Also verify direct API writes reject invalid values.

Vehicle mileage is stored in kilometers. VIN is optional; when supplied, validation requires 17 uppercase characters excluding I, O and Q. Vehicle year allows 1886 through next year. Database constraints provide the same limits as frontend validation.

## Checks

```sh
npm run lint
npm test
npm run format:check
npm run build
npm run scan:secrets
```

Before any public push, install Gitleaks and run `npm run security:preflight` after authorized staging. This fails if Git inspection or scanning is unavailable, or sensitive indexed files/secrets are detected. Review personal information manually as described in [SECURITY.md](SECURITY.md). No commit, push or publication is authorized automatically by passing checks.

Tests cover vehicle validation boundaries, accessible loading/error states, authenticated writes, and exclusion of protected fields from vehicle edits. GitHub Actions runs these checks plus Gitleaks history scanning. Enable branch protection and require both workflow jobs before merging. Gitleaks may require its action license for organization-owned repositories; consult its action documentation if applicable.

## Structure

- `src/components`: shared layout, session context and states
- `src/pages`: authentication, garage, vehicle forms/details and settings
- `src/services`: Supabase client, vehicle operations and validation
- `src/hooks`: garage data loading
- `src/types`: vehicle contracts
- `server`: trusted Firebase Admin provisioning endpoint (never bundled into the browser)
- `supabase/migrations`: schema, constraints and owner policies
- `scripts`: local source secret scanning

Deploy `dist/` after `npm run build`. Configure your host to rewrite application routes to `index.html` for React Router. Add the production hostname to Firebase authorized domains and review verification return URLs before testing login. This project has not been deployed, committed or pushed automatically.
