import { spawn } from 'node:child_process'

const namespace = 'marketplace-hw28'
const selector = 'app=marketplace-api'
const proxyPort = 18001

function command(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', d => { stdout += d })
    child.stderr.on('data', d => { stderr += d })
    child.once('error', reject)
    child.once('exit', code => {
      if (code === 0) resolve(stdout)
      else reject(new Error(stderr || stdout))
    })
  })
}

async function waitForProxy() {
  for (let i = 0; i < 50; i += 1) {
    try {
      const r = await fetch(`http://127.0.0.1:${proxyPort}/version`)
      if (r.ok) return
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('kubectl proxy did not start')
}

async function evict(name) {
  const url =
    `http://127.0.0.1:${proxyPort}/api/v1/namespaces/${namespace}/pods/${encodeURIComponent(name)}/eviction`

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      apiVersion: 'policy/v1',
      kind: 'Eviction',
      metadata: {
        name,
        namespace
      }
    })
  })
  await response.text()
  return response.status
}

const podsJson = JSON.parse(await command('kubectl', [
  '-n', namespace,
  'get', 'pods',
  '-l', selector,
  '-o', 'json'
]))

const healthy = (podsJson.items ?? []).filter(p =>
  p.status?.phase === 'Running' &&
  (p.status?.conditions ?? []).some(c => c.type === 'Ready' && c.status === 'True')
)

if (healthy.length < 3) {
  throw new Error(`Need 3 healthy pods, got ${healthy.length}`)
}

const proxy = spawn('kubectl', ['proxy', `--port=${proxyPort}`], {
  stdio: 'ignore'
})

try {
  await waitForProxy()

  const first = await evict(healthy[0].metadata.name)
  await new Promise(resolve => setTimeout(resolve, 250))
  const second = await evict(healthy[1].metadata.name)

  console.log(`healthy=${healthy.length}`)
  console.log('minAvailable=2')
  console.log(`evict-1=${first}`)
  console.log(`evict-2=${second}`)

  if (!(healthy.length >= 3 && first === 201 && second === 429)) {
    process.exitCode = 1
  }
} finally {
  proxy.kill('SIGTERM')
}
