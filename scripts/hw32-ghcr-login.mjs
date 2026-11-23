import { spawnSync } from 'node:child_process'

const token = process.env.GITHUB_TOKEN
const actor = process.env.GITHUB_ACTOR

if (!token || !actor) {
  console.error('GitHub runtime credentials are unavailable')
  process.exit(2)
}

const result = spawnSync(
  'docker',
  ['login', 'ghcr.io', '-u', actor, '--password-stdin'],
  {
    input: token,
    encoding: 'utf8',
    stdio: ['pipe', 'inherit', 'inherit']
  }
)

process.exit(result.status ?? 1)
