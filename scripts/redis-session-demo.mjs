import { randomUUID } from 'node:crypto'
import { deleteNamespace, queueRedis, sleep } from './redis-utils.mjs'

const redis = queueRedis()
const PREFIX = 'hw23:session:'
const SESSION_TTL = 5
let requests = 0
const seenSessions = new Set()

async function request(sessionId) {
  requests += 1
  const key = `${PREFIX}${sessionId}`
  let value = await redis.getex(key, 'EX', SESSION_TTL)
  if (!value) {
    value = JSON.stringify({ sessionId, userId: 'demo-user', createdAt: new Date().toISOString() })
    await redis.set(key, value, 'EX', SESSION_TTL)
  }
  seenSessions.add(sessionId)
  return JSON.parse(value)
}

try {
  await deleteNamespace(redis, PREFIX)
  const sessionId = randomUUID()
  await request(sessionId)
  await sleep(2000)

  const key = `${PREFIX}${sessionId}`
  const ttlBefore = await redis.ttl(key)
  await request(sessionId)
  const ttlAfter = await redis.ttl(key)
  await request(sessionId)

  const sessions = seenSessions.size
  const inRedis = (await redis.exists(key)) === 1 ? 1 : 0
  const ttlRenewed = ttlAfter > ttlBefore ? 1 : 0

  console.log(`requests=${requests}`)
  console.log(`sessions=${sessions}`)
  console.log(`in-redis=${inRedis}`)
  console.log(`ttl-renewed=${ttlRenewed}`)

  if (!(requests >= 3 && sessions === 1 && inRedis === 1 && ttlRenewed === 1)) process.exitCode = 1
} finally {
  await deleteNamespace(redis, PREFIX)
  await redis.quit()
}
