import { spawnSync } from 'node:child_process'
import { relative, resolve } from 'node:path'

const sensitivePaths = [
  '.env',
  '.env.local',
  'server/.env.local',
  'server/provisioning.env',
  'server/firebase-admin.json',
  'server/project-firebase-adminsdk-example.json',
  'supabase-root.crt',
  'private/config.json',
  'credentials/config.json',
  'secrets/config.json',
  'backups/export.sql',
  'backup.sql',
  'backup.sql.gz',
  '.vscode/settings.json',
  '.tmp/report.json',
  'development.log',
  'node_modules/example.js',
  'dist/index.html',
]
const publicPaths = [
  '.env.example',
  'server/.env.example',
  'package.json',
  'supabase/migrations/example.sql',
  'public/example.crt',
]
let failed = false
function check(path, expectedIgnored) {
  const result = spawnSync(
    'git',
    [
      '-c',
      `safe.directory=${process.cwd()}`,
      'check-ignore',
      '--quiet',
      '--no-index',
      '--',
      path,
    ],
    { stdio: 'ignore' },
  )
  const passed =
    !result.error &&
    [0, 1].includes(result.status) &&
    (result.status === 0) === expectedIgnored
  console.log(
    `${passed ? 'PASS' : 'FAIL'}: ${path} ${expectedIgnored ? 'is ignored' : 'remains trackable'}`,
  )
  failed ||= !passed
}
for (const path of sensitivePaths) check(path, true)
for (const path of publicPaths) check(path, false)
if (process.platform === 'win32') {
  for (const path of [
    'C:/private/scsb/firebase-admin.json',
    'C:/private/scsb/provisioning.env',
    'C:/private/scsb/supabase-root.crt',
  ]) {
    const outside = relative(resolve('.'), resolve(path)).startsWith('..')
    console.log(
      `${outside ? 'PASS' : 'FAIL'}: ${path} is outside this repository`,
    )
    failed ||= !outside
  }
}
if (failed) process.exitCode = 1
