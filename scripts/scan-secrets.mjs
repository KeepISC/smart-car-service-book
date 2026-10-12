import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
const skip = new Set(['node_modules', '.git', 'dist', 'coverage'])
const patterns = [
  /sb_secret_[A-Za-z0-9_-]{16,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /(?:ghp_|github_pat_)[A-Za-z0-9_]{20,}/,
  /AKIA[A-Z0-9]{16}/,
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,
]
let failed = false
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (
      skip.has(entry.name) ||
      (entry.name.startsWith('.env') && entry.name !== '.env.example')
    )
      continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) await walk(path)
    else if (entry.isFile()) {
      const text = await readFile(path, 'utf8')
      if (patterns.some((p) => p.test(text))) {
        console.error(`Possible secret in ${path}`)
        failed = true
      }
    }
  }
}
await walk('.')
if (failed) process.exitCode = 1
else
  console.log(
    'Secret scan passed (source files only; private environment files excluded).',
  )
