import {
  HeadObjectCommand,
  PutObjectCommand
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import net from 'node:net'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import {
  cleanBucket,
  ensureBucket,
  s3Client,
  sleep,
  storageConfig
} from './storage-utils.mjs'

const s3 = s3Client()
const cfg = storageConfig()
const state = new Map()
const contentType = 'image/png'
const maliciousFilename = '../../etc/passwd'
const temp = await mkdtemp(join(tmpdir(), 'hw26-upload-'))
const file = join(temp, 'payload.bin')
await writeFile(file, Buffer.from('hw26-direct-upload-bytes'))

function json(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) })
  res.end(body)
}

async function makeIntent(filename, ttl = 120) {
  const key = `uploads/demo-user/${randomUUID()}.png`
  const uploadUrl = await getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: cfg.bucket, Key: key, ContentType: contentType }),
    { expiresIn: ttl }
  )
  const id = randomUUID()
  state.set(id, { key, status: 'PENDING' })
  return { id, key, uploadUrl, filename }
}

async function makeServer(port) {
  const server = createServer(async (req, res) => {
    try {
      if (req.method === 'POST' && req.url === '/uploads/intent') {
        let raw = ''
        for await (const chunk of req) raw += chunk
        const body = raw ? JSON.parse(raw) : {}
        return json(res, 200, await makeIntent(body.filename))
      }

      if (req.method === 'POST' && req.url === '/uploads/commit') {
        let raw = ''
        for await (const chunk of req) raw += chunk
        const body = JSON.parse(raw || '{}')
        const row = state.get(body.id)
        if (!row) return json(res, 404, { error: 'not found' })

        try {
          await s3.send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: row.key }))
        } catch {
          return json(res, 409, { error: 'bytes missing' })
        }

        row.status = 'COMPLETED'
        return json(res, 200, { id: body.id, key: row.key, status: row.status })
      }

      json(res, 404, { error: 'not found' })
    } catch (error) {
      json(res, 500, { error: error instanceof Error ? error.message : 'error' })
    }
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolve)
  })
  return server
}

function portAlive(port) {
  return new Promise(resolve => {
    const socket = net.connect({ host: '127.0.0.1', port })
    socket.once('connect', () => { socket.destroy(); resolve(1) })
    socket.once('error', () => resolve(0))
    socket.setTimeout(500, () => { socket.destroy(); resolve(0) })
  })
}

async function directPutWithoutCredentials(url) {
  return new Promise((resolve, reject) => {
    let output = ''
    const env = {
      PATH: process.env.PATH ?? '',
      SystemRoot: process.env.SystemRoot ?? '',
      WINDIR: process.env.WINDIR ?? ''
    }
    const child = spawn(process.execPath, ['scripts/presigned-put.mjs', url, file, contentType], {
      cwd: process.cwd(),
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    child.stdout.on('data', d => { output += d })
    child.stderr.on('data', d => { output += d })
    child.once('error', reject)
    child.once('exit', code => {
      const match = output.match(/status=(\d+)/)
      resolve({ code, status: match ? Number(match[1]) : 0 })
    })
  })
}

let server1
let server2

try {
  await ensureBucket(s3, cfg.bucket)
  await cleanBucket(s3, cfg.bucket)

  const port1 = 23126
  const port2 = 23127
  server1 = await makeServer(port1)

  const intentResponse = await fetch(`http://127.0.0.1:${port1}/uploads/intent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ filename: maliciousFilename, contentType })
  })
  const intent = await intentResponse.json()

  const keyFromServer = !intent.key.includes('etc') && !intent.key.includes('passwd') && !intent.key.includes('..') ? 1 : 0

  const noBytes = await makeIntent('nothing.png')
  const noBytesResponse = await fetch(`http://127.0.0.1:${port1}/uploads/commit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: noBytes.id })
  })

  const tampered = new URL(intent.uploadUrl)
  tampered.pathname = tampered.pathname.replace(/[^/]+$/, 'tampered.png')
  const tamperedResponse = await fetch(tampered, {
    method: 'PUT',
    headers: { 'content-type': contentType },
    body: Buffer.from('tampered')
  })

  await new Promise(resolve => server1.close(resolve))
  server1 = undefined
  const apiAlive = await portAlive(port1)

  const put = await directPutWithoutCredentials(intent.uploadUrl)

  server2 = await makeServer(port2)
  const commitResponse = await fetch(`http://127.0.0.1:${port2}/uploads/commit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: intent.id })
  })

  const expiring = await makeIntent('expire.png', 1)
  await sleep(2200)
  const expiredResponse = await fetch(expiring.uploadUrl, {
    method: 'PUT',
    headers: { 'content-type': contentType },
    body: Buffer.from('expired')
  })

  console.log(`intent=${intentResponse.status}`)
  console.log(`key-from-server=${keyFromServer}`)
  console.log(`api-alive=${apiAlive}`)
  console.log(`put-offline=${put.status}`)
  console.log(`commit=${commitResponse.status}`)
  console.log(`commit-without-bytes=${noBytesResponse.status}`)
  console.log(`tampered=${tamperedResponse.status}`)
  console.log(`expired=${expiredResponse.status}`)

  const ok =
    intentResponse.status === 200 &&
    keyFromServer === 1 &&
    apiAlive === 0 &&
    put.status === 200 &&
    commitResponse.status === 200 &&
    noBytesResponse.status >= 400 &&
    noBytesResponse.status < 500 &&
    tamperedResponse.status === 403 &&
    expiredResponse.status === 403

  if (!ok) process.exitCode = 1
} finally {
  if (server1) await new Promise(resolve => server1.close(resolve))
  if (server2) await new Promise(resolve => server2.close(resolve))
  await cleanBucket(s3, cfg.bucket).catch(() => undefined)
  await rm(temp, { recursive: true, force: true })
  s3.destroy()
}
