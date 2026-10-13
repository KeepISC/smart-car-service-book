import { readFile } from 'node:fs/promises'
import { assessIntegrationEnvironment } from './integration-environment.mjs'

let adminProjectId
try {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS)
    adminProjectId = JSON.parse(
      await readFile(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'),
    ).project_id
} catch {
  // Never expose credential-loader paths, private JSON, or parse diagnostics.
}
const result = assessIntegrationEnvironment(process.env, adminProjectId)
console.log(
  JSON.stringify(
    {
      status: result.configurationSafeToTest
        ? 'ISOLATED CONFIGURATION ONLY — AUTH/API ACCEPTANCE STILL REQUIRED'
        : 'BLOCKED — ISOLATED CONFIGURATION UNAVAILABLE',
      ...result,
    },
    null,
    2,
  ),
)
if (!result.configurationSafeToTest) process.exitCode = 1
