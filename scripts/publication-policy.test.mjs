// @vitest-environment node
import { expect, it } from 'vitest'
import { forbiddenPublicationPath } from './publication-policy.mjs'

it.each([
  '.env.local',
  'server/.env.local',
  'server/provisioning.env',
  'server/firebase-admin.json',
  'server/project-firebase-adminsdk-example.json',
  'private/data.json',
  'keys/signing.key',
  'backups/export.sql',
  'export.sql.gz',
  '.vscode/settings.json',
  'supabase-root.crt',
  '.npmrc',
  'backup.sql',
])('blocks private publication path %s', (path) => {
  expect(forbiddenPublicationPath(path)).toBe(true)
})

it.each([
  '.env.example',
  'server/.env.example',
  'package.json',
  'public/example.crt',
  'supabase/migrations/example.sql',
])('allows legitimate project resource %s', (path) => {
  expect(forbiddenPublicationPath(path)).toBe(false)
})
