import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const namespace = 'marketplace-hw28'
const deployment = 'marketplace-api'
const endpoint = process.env.HW28_URL ?? 'http://127.0.0.1:30080/healthz'
const minimumRequests = 5000
const concurrency = Number(process.env.HW28_CONCURRENCY ?? '64')

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options
    })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', chunk => { stdout += chunk })
    child.stderr?.on('data', chunk => { stderr += chunk })
    child.once('error', reject)
    child.once('exit', code => {
      if (code === 0) resolve({ stdout, stderr })
      else reject(new Error(`${command} exited ${code}: ${stderr || stdout}`))
    })
  })
}

const temp = await mkdtemp(join(tmpdir(), 'hw28-rollout-'))
const codesFile = join(temp, 'codes.txt')
const out = createWriteStream(codesFile, { flags: 'a' })
let completed = 0
let rolloutDone = false
let stopping = false

async function requestOnce() {
  let code = 0

  try {
    code = await new Promise(resolve => {
      const url = new URL(endpoint)
      const client = url.protocol === 'https:' ? https : http

      const request = client.request(
        url,
        {
          method: 'GET',
          agent: false,
          headers: {
            Connection: 'close'
          }
        },
        response => {
          response.resume()
          response.once('end', () => {
            resolve(response.statusCode ?? 0)
          })
        }
      )

      request.setTimeout(2500, () => {
        request.destroy()
        resolve(0)
      })

      request.once('error', () => {
        resolve(0)
      })

      request.end()
    })
  } catch {
    code = 0
  }

  out.write(`${code}\n`)
  completed += 1
}

async function worker() {
  while (!stopping) {
    await requestOnce()
    if (rolloutDone && completed >= minimumRequests) {
      stopping = true
    }
  }
}

try {
  await run('kubectl', ['-n', namespace, 'rollout', 'status', `deployment/${deployment}`, '--timeout=120s'])

  const started = Date.now()
  const workers = Array.from({ length: concurrency }, () => worker())

  await new Promise(resolve => setTimeout(resolve, 500))

  const rev = `r${Date.now()}`
  await run('kubectl', [
    '-n', namespace,
    'patch', 'deployment', deployment,
    '--type=merge',
    '-p',
    JSON.stringify({
      spec: {
        template: {
          metadata: {
            annotations: {
              revision: rev
            }
          }
        }
      }
    })
  ])

  await run('kubectl', ['-n', namespace, 'rollout', 'status', `deployment/${deployment}`, '--timeout=180s'])
  rolloutDone = true

  while (completed < minimumRequests) {
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  stopping = true
  await Promise.all(workers)

  await new Promise(resolve => out.end(resolve))

  const elapsed = Math.max(1, Math.round((Date.now() - started) / 1000))
  const codes = (await readFile(codesFile, 'utf8'))
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)

  const requests = codes.length
  const ok = codes.filter(code => code === '200').length
  const failed = requests - ok

  console.log('profile=correct')
  console.log(`requests=${requests}`)
  console.log(`ok=${ok}`)
  console.log(`failed=${failed}`)
  console.log(`rollout-seconds=${elapsed}`)

  if (!(requests >= minimumRequests && failed === 0)) {
    process.exitCode = 1
  }
} finally {
  stopping = true
  out.end()
  await rm(temp, { recursive: true, force: true })
}
