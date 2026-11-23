import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve('.')
const isWin = process.platform === 'win32'

function run(command, args, env = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    shell: isWin
  })

  if (result.error) {
    process.stderr.write(String(result.error) + '\n')
    return 127
  }

  return result.status ?? 1
}

function dockerOasdiff(base, revision) {
  return run('docker', [
    'run',
    '--rm',
    '-v', root + '/hw32-fixtures/contract:/specs:ro',
    'tufin/oasdiff:v1.39.0',
    'breaking',
    '/specs/' + base,
    '/specs/' + revision
  ])
}

const temp = mkdtempSync(join(tmpdir(), 'hw32-gates-'))
const brokenTs = join(temp, 'broken.ts')
writeFileSync(brokenTs, 'const answer: string = 42\n')

try {
  const typeCheck = run('npx', ['tsc', '--noEmit'])
  const lintCheck = run('npx', [
    '--yes',
    'eslint@9.39.1',
    'scripts/hw32-*.mjs',
    '--max-warnings=0'
  ])
  const typesOk = typeCheck === 0 && lintCheck === 0 ? 0 : 1

  const typesBroken = run('npx', [
    'tsc',
    '--noEmit',
    '--strict',
    '--target',
    'ES2022',
    brokenTs
  ])

  const contractOk = dockerOasdiff('base.yaml', 'good.yaml')
  const contractBroken = dockerOasdiff('base.yaml', 'broken.yaml')

  const architectureOk = run('npx', [
    '--yes',
    'dependency-cruiser@18.8.0',
    '--config',
    '.dependency-cruiser.cjs',
    '--',
    'hw32-fixtures/architecture/ok'
  ])

  const architectureBroken = run('npx', [
    '--yes',
    'dependency-cruiser@18.8.0',
    '--config',
    '.dependency-cruiser.cjs',
    '--',
    'hw32-fixtures/architecture/broken',
    'hw32-fixtures/architecture/forbidden'
  ])

  const image = 'gcr.io/distroless/nodejs22-debian12:nonroot'
  const imageOk = run('node', ['scripts/hw28-scan.mjs'], {
    APP_IMAGE: image,
    SCAN_MAX: '99999'
  })
  const imageBroken = run('node', ['scripts/hw28-scan.mjs'], {
    APP_IMAGE: image,
    SCAN_MAX: '-1'
  })

  const results = {
    types: [typesOk, typesBroken],
    contract: [contractOk, contractBroken],
    architecture: [architectureOk, architectureBroken],
    image: [imageOk, imageBroken]
  }

  let invalid = 0

  for (const [name, [ok, broken]] of Object.entries(results)) {
    console.log(name + '-ok=' + ok)
    console.log(name + '-broken=' + broken)
    if (ok !== 0 || broken === 0) invalid += 1
  }

  process.exit(invalid === 0 ? 0 : 1)
} finally {
  rmSync(temp, { recursive: true, force: true })
}
