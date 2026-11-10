import {
  GetObjectCommand,
  PutObjectCommand
} from '@aws-sdk/client-s3'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import {
  cleanBucket,
  directObjectUrl,
  ensureBucket,
  s3Client,
  storageConfig
} from './storage-utils.mjs'

const s3 = s3Client()
const cfg = storageConfig()
const cache = new Map()

function assetName(body) {
  const hash = createHash('sha256').update(body).digest('hex').slice(0, 8)
  return `assets/app.${hash}.css`
}

async function publish(body) {
  const key = assetName(body)
  await s3.send(new PutObjectCommand({
    Bucket: cfg.bucket,
    Key: key,
    Body: body,
    ContentType: 'text/css',
    CacheControl: 'public, max-age=31536000, immutable'
  }))
  return key
}

async function streamToBuffer(stream) {
  const chunks = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

async function startEdge(port) {
  const server = createServer(async (req, res) => {
    try {
      const prefix = '/assets/'
      if (!req.url?.startsWith(prefix)) {
        res.writeHead(404); res.end(); return
      }
      const key = decodeURIComponent(req.url.slice(1))
      const cached = cache.get(key)
      if (cached) {
        res.writeHead(200, {
          'content-type': cached.contentType,
          'cache-control': cached.cacheControl,
          'x-cache': 'HIT'
        })
        res.end(cached.body)
        return
      }

      const object = await s3.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }))
      const body = await streamToBuffer(object.Body)
      const cacheControl = object.CacheControl ?? ''
      if (/max-age=\d+/.test(cacheControl)) {
        cache.set(key, {
          body,
          contentType: object.ContentType ?? 'application/octet-stream',
          cacheControl
        })
      }
      res.writeHead(200, {
        'content-type': object.ContentType ?? 'application/octet-stream',
        'cache-control': cacheControl,
        'x-cache': 'MISS'
      })
      res.end(body)
    } catch {
      res.writeHead(404); res.end()
    }
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolve)
  })
  return server
}

let edge
try {
  await ensureBucket(s3, cfg.bucket)
  await cleanBucket(s3, cfg.bucket)

  const oldBody = 'body{background:#111}'
  const newBody = 'body{background:#222}'
  const oldKey = await publish(oldBody)

  const directResponse = await fetch(directObjectUrl(oldKey))
  const port = 23128
  edge = await startEdge(port)
  const oldUrl = `http://127.0.0.1:${port}/${oldKey}`

  const missResponse = await fetch(oldUrl)
  const missBody = await missResponse.text()
  const hitResponse = await fetch(oldUrl)
  await hitResponse.text()
  const cacheHit = hitResponse.headers.get('x-cache') === 'HIT' ? 1 : 0

  const newKey = await publish(newBody)
  const newName = newKey !== oldKey ? 1 : 0
  const newUrl = `http://127.0.0.1:${port}/${newKey}`
  const newResponse = await fetch(newUrl)
  const receivedNewBody = await newResponse.text()
  const contentChanged = receivedNewBody !== missBody && receivedNewBody === newBody ? 1 : 0

  console.log(`direct=${directResponse.status}`)
  console.log(`edge-miss=${missResponse.status}`)
  console.log(`edge-hit=${hitResponse.status}`)
  console.log(`cache-hit=${cacheHit}`)
  console.log(`new-name=${newName}`)
  console.log(`new-url=${newResponse.status}`)
  console.log(`content-changed=${contentChanged}`)

  if (!(directResponse.status === 403 && missResponse.status === 200 && hitResponse.status === 200 &&
        cacheHit === 1 && newName === 1 && newResponse.status === 200 && contentChanged === 1)) {
    process.exitCode = 1
  }
} finally {
  if (edge) await new Promise(resolve => edge.close(resolve))
  await cleanBucket(s3, cfg.bucket).catch(() => undefined)
  s3.destroy()
}
