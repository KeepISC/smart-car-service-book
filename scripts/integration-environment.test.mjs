import { expect, it } from 'vitest'
import { assessIntegrationEnvironment } from './integration-environment.mjs'

const isolated = {
  SCSB_ISOLATED_INTEGRATION: 'true',
  VITE_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
  VITE_FIREBASE_PROJECT_ID: 'fictional-integration',
  FIREBASE_PROJECT_ID: 'fictional-integration',
  VITE_SUPABASE_PUBLISHABLE_KEY: 'fictional-public-config',
  VITE_FIREBASE_API_KEY: 'fictional-public-config',
  VITE_FIREBASE_AUTH_DOMAIN: 'fictional-integration.firebaseapp.com',
  VITE_FIREBASE_APP_ID: 'fictional-public-config',
  PROVISIONING_DATABASE_URL:
    'postgresql://scsb_provisioning_local:fictional-disposable-only@db.abcdefghijklmnopqrst.supabase.co:5432/postgres',
  VITE_FIREBASE_PROVISIONING_URL: 'http://localhost:8797/provision',
  PROVISIONING_DATABASE_CA_FILE: 'fictional-private-ca',
}
it('blocks production-connected configuration without exposing it', () => {
  const result = assessIntegrationEnvironment(
    {
      ...isolated,
      VITE_SUPABASE_URL: 'https://ttwlscydylnaogawmgce.supabase.co',
    },
    'fictional-integration',
  )
  expect(result.configurationSafeToTest).toBe(false)
  expect(result.failedChecks).toContain('disposable_supabase')
  expect(JSON.stringify(result)).not.toContain('postgresql://')
})
it('requires explicit isolation and matching non-production Admin identity', () => {
  expect(
    assessIntegrationEnvironment(
      { ...isolated, SCSB_ISOLATED_INTEGRATION: undefined },
      'fictional-integration',
    ).configurationSafeToTest,
  ).toBe(false)
  expect(
    assessIntegrationEnvironment(isolated, 'smart-car-service-book-61a9d')
      .configurationSafeToTest,
  ).toBe(false)
})
it('does not mistake isolated configuration for verified authentication', () => {
  const result = assessIntegrationEnvironment(isolated, 'fictional-integration')
  expect(result.configurationSafeToTest).toBe(true)
  expect(result.realAuthenticationVerified).toBe(false)
})
it('rejects the existing production-connected provisioning port and a production database', () => {
  const result = assessIntegrationEnvironment(
    {
      ...isolated,
      VITE_FIREBASE_PROVISIONING_URL: 'http://localhost:8787/provision',
      PROVISIONING_DATABASE_URL:
        'postgresql://scsb_provisioning_local:fictional-disposable-only@db.ttwlscydylnaogawmgce.supabase.co:5432/postgres',
    },
    'fictional-integration',
  )
  expect(result.failedChecks).toEqual(
    expect.arrayContaining([
      'isolated_database',
      'separate_provisioning_endpoint',
    ]),
  )
})
