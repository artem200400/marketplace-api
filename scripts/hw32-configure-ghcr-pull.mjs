import { spawnSync } from 'node:child_process'

const token = process.env.GITHUB_TOKEN
const actor = process.env.GITHUB_ACTOR
const namespace = process.env.HW32_NAMESPACE ?? 'marketplace-hw28'

if (!token || !actor) {
  console.error('GitHub runtime credentials are unavailable')
  process.exit(2)
}

const auth = Buffer.from(actor + ':' + token).toString('base64')
const dockerConfig = {
  auths: {
    'ghcr.io': {
      username: actor,
      password: token,
      auth
    }
  }
}

const manifest = {
  apiVersion: 'v1',
  kind: 'Secret',
  metadata: {
    name: 'ghcr-pull',
    namespace
  },
  type: 'kubernetes.io/dockerconfigjson',
  data: {
    '.dockerconfigjson': Buffer.from(JSON.stringify(dockerConfig)).toString('base64')
  }
}

let result = spawnSync(
  'kubectl',
  ['apply', '-f', '-'],
  {
    input: JSON.stringify(manifest),
    encoding: 'utf8',
    stdio: ['pipe', 'inherit', 'inherit']
  }
)

if ((result.status ?? 1) !== 0) process.exit(result.status ?? 1)

result = spawnSync(
  'kubectl',
  [
    '-n', namespace,
    'patch', 'serviceaccount', 'default',
    '--type=merge',
    '-p',
    JSON.stringify({ imagePullSecrets: [{ name: 'ghcr-pull' }] })
  ],
  {
    encoding: 'utf8',
    stdio: 'inherit'
  }
)

process.exit(result.status ?? 1)
