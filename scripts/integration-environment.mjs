// This assessment never connects, provisions an identity, or prints credentials.
const productionSupabase = 'ttwlscydylnaogawmgce'
const productionFirebase = 'smart-car-service-book-61a9d'
function configured(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    !/REPLACE|your-|placeholder/i.test(value)
  )
}
function parsedUrl(value) {
  try {
    return new URL(value)
  } catch {
    return null
  }
}
export function assessIntegrationEnvironment(env, adminProjectId) {
  const supabase = parsedUrl(env.VITE_SUPABASE_URL)
  const database = parsedUrl(env.PROVISIONING_DATABASE_URL)
  const provisioner = parsedUrl(env.VITE_FIREBASE_PROVISIONING_URL)
  const project = supabase?.hostname.match(/^([a-z]{20})\.supabase\.co$/)?.[1]
  const checks = {
    explicit_isolation: env.SCSB_ISOLATED_INTEGRATION === 'true',
    disposable_supabase: Boolean(
      project &&
      project !== productionSupabase &&
      supabase.protocol === 'https:',
    ),
    disposable_firebase:
      configured(env.VITE_FIREBASE_PROJECT_ID) &&
      env.VITE_FIREBASE_PROJECT_ID !== productionFirebase,
    matching_private_admin:
      configured(adminProjectId) &&
      adminProjectId !== productionFirebase &&
      adminProjectId === env.VITE_FIREBASE_PROJECT_ID &&
      env.FIREBASE_PROJECT_ID === adminProjectId,
    browser_configuration: [
      'VITE_SUPABASE_PUBLISHABLE_KEY',
      'VITE_FIREBASE_API_KEY',
      'VITE_FIREBASE_AUTH_DOMAIN',
      'VITE_FIREBASE_APP_ID',
    ].every((key) => configured(env[key])),
    isolated_database: Boolean(
      project &&
      project !== productionSupabase &&
      database &&
      ['postgres:', 'postgresql:'].includes(database.protocol) &&
      database.port === '5432' &&
      database.pathname === '/postgres' &&
      database.password &&
      (database.hostname === `db.${project}.supabase.co` ||
        (/\.pooler\.supabase\.com$/.test(database.hostname) &&
          database.username.endsWith(`.${project}`))),
    ),
    separate_provisioning_endpoint: Boolean(
      provisioner &&
      (provisioner.protocol === 'https:' ||
        (provisioner.protocol === 'http:' &&
          ['localhost', '127.0.0.1'].includes(provisioner.hostname) &&
          provisioner.port !== '8787')),
    ),
    database_ca_configured: configured(env.PROVISIONING_DATABASE_CA_FILE),
  }
  return {
    configurationSafeToTest: Object.values(checks).every(Boolean),
    checks,
    failedChecks: Object.entries(checks)
      .filter(([, passed]) => !passed)
      .map(([name]) => name),
    realAuthenticationVerified: false,
  }
}
