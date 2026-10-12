import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { forbiddenPublicationPath } from './publication-policy.mjs'

function fail(message) {
  console.error(`RELEASE BLOCKED: ${message}`)
  process.exit(1)
}
function git(args) {
  const result = spawnSync(
    'git',
    ['-c', `safe.directory=${process.cwd()}`, ...args],
    {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    },
  )
  if (result.error || result.status !== 0)
    fail(
      'Git inspection failed. Run this check from an initialized repository.',
    )
  return result.stdout
}
git(['rev-parse', '--show-toplevel'])
// Inspect the index, including already tracked files that .gitignore cannot protect.
const paths = git(['ls-files', '-z']).split('\0').filter(Boolean)
for (const path of paths) {
  if (forbiddenPublicationPath(path))
    fail(
      `Forbidden file in the index: ${path}. Remove it from version control before release.`,
    )
}
const scanner = process.env.GITLEAKS_BINARY || 'gitleaks'
const available = spawnSync(scanner, ['version'], { stdio: 'ignore' })
if (available.error || available.status !== 0)
  fail('Install Gitleaks v8.19+ and put it on PATH, then rerun this check.')
// Include untracked commit candidates: an empty index must not produce a false pass.
const candidates = git([
  'ls-files',
  '--cached',
  '--others',
  '--exclude-standard',
  '-z',
])
  .split('\0')
  .filter(Boolean)
if (candidates.some(forbiddenPublicationPath))
  fail('Forbidden private file among publication candidates.')
const directory = mkdtempSync(join(tmpdir(), 'scsb-publication-'))
let candidateScan
try {
  for (const path of new Set(candidates)) {
    if (lstatSync(path).isSymbolicLink())
      throw new Error('Review publication symlinks before scanning')
    const target = resolve(directory, path)
    if (
      !target.startsWith(
        `${resolve(directory)}${process.platform === 'win32' ? '\\' : '/'}`,
      )
    )
      throw new Error('Invalid candidate path')
    mkdirSync(dirname(target), { recursive: true })
    copyFileSync(path, target)
  }
  candidateScan = spawnSync(
    scanner,
    [
      'dir',
      '--redact=100',
      '--no-banner',
      '--ignore-gitleaks-allow',
      directory,
    ],
    { stdio: 'ignore' },
  )
} finally {
  // Only remove the exact temporary directory created above, never a caller-selected path.
  if (
    dirname(resolve(directory)) === resolve(tmpdir()) &&
    directory.includes('scsb-publication-')
  )
    rmSync(directory, { recursive: true, force: true })
}
if (candidateScan?.error || candidateScan?.status !== 0)
  fail('Publication candidate scanning failed or found sensitive information.')
console.log(
  `PASS: ${new Set(candidates).size} publication candidates scanned; nothing staged.`,
)
// Send the staged patch directly through stdin; never persist or print its contents.
const patch = git([
  'diff',
  '--cached',
  '--no-ext-diff',
  '--no-textconv',
  '--binary',
])
const staged = spawnSync(
  scanner,
  ['stdin', '--redact=100', '--no-banner', '--ignore-gitleaks-allow'],
  {
    input: patch,
    stdio: ['pipe', 'ignore', 'ignore'],
  },
)
if (staged.error || staged.status !== 0)
  fail('Staged secret scanning failed or found sensitive information.')
const head = spawnSync(
  'git',
  ['-c', `safe.directory=${process.cwd()}`, 'rev-parse', '--verify', 'HEAD'],
  {
    stdio: 'ignore',
  },
)
if (head.status === 0) {
  const history = spawnSync(
    scanner,
    [
      'git',
      '--redact=100',
      '--no-banner',
      '--ignore-gitleaks-allow',
      '--log-opts=--all --full-history',
      '.',
    ],
    {
      stdio: 'ignore',
      env: {
        ...process.env,
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'safe.directory',
        GIT_CONFIG_VALUE_0: process.cwd(),
      },
    },
  )
  if (history.error || history.status !== 0)
    fail('Repository history scanning failed or found sensitive information.')
} else {
  console.log('No commits exist yet; repository history is empty.')
}
console.log(
  'Staged files and available history passed automated checks. Manual personal-data review and explicit publication approval are still required.',
)
