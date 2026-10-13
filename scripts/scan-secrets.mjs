import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
// Scan the exact publication candidates, including untracked source and tracked
// files that ignore rules cannot protect. Private local tooling is outside Git.
const files = execFileSync(
  'git',
  [
    '-c',
    `safe.directory=${process.cwd()}`,
    'ls-files',
    '--cached',
    '--others',
    '--exclude-standard',
    '-z',
  ],
  { encoding: 'utf8' },
)
  .split('\0')
  .filter(Boolean)
const patterns = [
  /sb_secret_[A-Za-z0-9_-]{16,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /(?:ghp_|github_pat_)[A-Za-z0-9_]{20,}/,
  /AKIA[A-Z0-9]{16}/,
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,
]
let failed = false
for (const path of new Set(files)) {
  const text = await readFile(path, 'utf8')
  if (patterns.some((p) => p.test(text))) {
    console.error(`Possible secret in ${path}`)
    failed = true
  }
}
if (failed) process.exitCode = 1
else
  console.log(
    'Secret scan passed (all tracked and untracked publication candidates).',
  )
