import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const manifestPath = process.env.SCSB_RECOVERY_MANIFEST
assert.ok(manifestPath, 'Set the private backup manifest path')
assert.equal(
  path.dirname(path.resolve(manifestPath)),
  path.resolve('C:/private/scsb/backups'),
)
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
assert.equal(manifest.project, 'ttwlscydylnaogawmgce')
assert.equal(manifest.snapshot_consistent, true)
const hash = (value) => createHash('sha256').update(value).digest('hex')
assert.equal(hash(await readFile(manifest.archive)), manifest.sha256)
const files = [
  '202610100001_create_vehicles.sql',
  '202610110001_maintenance_schedules.sql',
  '202610110002_firebase_identity.sql',
  '202610120001_vehicle_maintenance_consistency.sql',
  '202610120002_service_history.sql',
]

// Split only outside strings, comments and dollar-quoted function bodies.
// Ignore SQL comments/outer whitespace; preserve quoted content and statement order.
// CRLF/LF is normalized to account for the CLI's recorded statement representation.
function statements(sql) {
  const result = []
  let tokens = []
  for (let index = 0; index < sql.length;) {
    const char = sql[index]
    if (/\s/.test(char)) {
      index++
      continue
    }
    if (sql.startsWith('--', index)) {
      const end = sql.indexOf('\n', index)
      index = end < 0 ? sql.length : end + 1
      continue
    }
    if (sql.startsWith('/*', index)) {
      let depth = 1
      index += 2
      while (index < sql.length && depth) {
        if (sql.startsWith('/*', index)) {
          depth++
          index += 2
        } else if (sql.startsWith('*/', index)) {
          depth--
          index += 2
        } else index++
      }
      assert.equal(depth, 0, 'Unterminated SQL comment')
      continue
    }
    if (char === "'" || char === '"') {
      const start = index++
      const escaped = char === "'" && tokens.at(-1)?.toLowerCase() === 'e'
      let closed = false
      while (index < sql.length) {
        if (escaped && sql[index] === '\\') {
          index += 2
          continue
        }
        if (sql[index++] === char) {
          if (sql[index] === char) {
            index++
            continue
          }
          closed = true
          break
        }
      }
      assert.ok(closed, 'Unterminated SQL quote')
      tokens.push(sql.slice(start, index).replaceAll('\r\n', '\n'))
      continue
    }
    const tag = sql.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)?.[0]
    if (tag) {
      const end = sql.indexOf(tag, index + tag.length)
      assert.ok(end >= 0, 'Unterminated SQL function body')
      tokens.push(sql.slice(index, end + tag.length).replaceAll('\r\n', '\n'))
      index = end + tag.length
      continue
    }
    if (char === ';') {
      if (tokens.length) result.push(tokens)
      tokens = []
      index++
      continue
    }
    const word = sql
      .slice(index)
      .match(/^[A-Za-z_][A-Za-z0-9_$]*|^\d+(?:\.\d+)?/)?.[0]
    tokens.push(word ?? char)
    index += word?.length ?? 1
  }
  if (tokens.length) result.push(tokens)
  return result
}

assert.deepEqual(
  manifest.history.map((row) => row.version),
  files.map((file) => file.split('_')[0]),
)
const report = []
for (const file of files) {
  const local = await readFile('supabase/migrations/' + file, 'utf8')
  const ledger = manifest.history.find(
    (row) => row.version === file.split('_')[0],
  )
  assert.ok(
    Array.isArray(ledger.statements) && ledger.statements.length > 0,
    'Recorded SQL unavailable',
  )
  const localStatements = statements(local)
  const recordedStatements = ledger.statements.flatMap(statements)
  assert.ok(
    JSON.stringify(localStatements) === JSON.stringify(recordedStatements),
    'Predecessor SQL differs: ' + file,
  )
  const canonicalSha256 = hash(JSON.stringify(localStatements))
  report.push({
    file,
    version: ledger.version,
    local_sha256: hash(local),
    statement_count: localStatements.length,
    canonical_sha256: canonicalSha256,
    recorded_sql_match: true,
  })
  console.log(
    'PASS recorded SQL content:',
    ledger.version,
    '; statements:',
    localStatements.length,
  )
}
await writeFile(
  manifest.archive + '.ledger-verification.json',
  JSON.stringify(report, null, 2),
  { flag: 'wx', mode: 0o600 },
)
console.log(
  'PASS all five predecessors; ordered SQL and function bodies match after outer formatting/comment and CRLF/LF normalization. No original checksum column exists.',
)
