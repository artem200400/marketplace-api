import { randomUUID } from 'node:crypto'
import { cacheRedis, createPool, deleteNamespace, releaseLock, sleep } from './redis-utils.mjs'

const redis = cacheRedis()
const pool = await createPool()
const PREFIX = 'hw23:cache:'
const BASE_TTL = 300
const JITTER = 60
let dbCalls = 0

function randomTtl() {
  return BASE_TTL + Math.floor(Math.random() * (JITTER + 1))
}

async function databaseRead() {
  dbCalls += 1
  const result = await pool.query(`
    SELECT id::text, name, price_cents, stock
    FROM products
    ORDER BY id
    LIMIT 1
  `)
  return result.rows[0] ?? { id: 'demo-product', name: 'Demo product', price_cents: 1000, stock: 10 }
}

async function cacheSet(key, value) {
  const ttl = randomTtl()
  try {
    await redis.set(key, JSON.stringify(value), 'EX', ttl)
  } catch {}
  return ttl
}

async function cacheAside(key) {
  const cached = await redis.get(key)
  if (cached) return JSON.parse(cached)

  const lockKey = `${PREFIX}lock:${key}`
  const token = randomUUID()
  const acquired = await redis.set(lockKey, token, 'PX', 5000, 'NX')

  if (acquired === 'OK') {
    try {
      const secondRead = await redis.get(key)
      if (secondRead) return JSON.parse(secondRead)
      const value = await databaseRead()
      await cacheSet(key, value)
      return value
    } finally {
      await releaseLock(redis, lockKey, token)
    }
  }

  for (let attempt = 0; attempt < 100; attempt += 1) {
    await sleep(25)
    const value = await redis.get(key)
    if (value) return JSON.parse(value)
  }

  return cacheAside(key)
}

try {
  await deleteNamespace(redis, PREFIX)

  const policy = await redis.config('GET', 'maxmemory-policy')
  const memory = await redis.config('GET', 'maxmemory')
  const cacheLru = String(policy[1]) === 'allkeys-lru' ? 1 : 0
  const cacheMaxmemory = Number(memory[1]) > 0 ? 1 : 0

  const warmed = 60
  const ttlValues = new Set()

  for (let index = 0; index < warmed; index += 1) {
    const key = `${PREFIX}warm:${index}`
    const value = await databaseRead()
    await cacheSet(key, value)
    ttlValues.add(await redis.ttl(key))
  }

  dbCalls = 0
  const coldKey = `${PREFIX}product:stampede`
  await redis.del(coldKey)

  const concurrent = 30
  await Promise.all(Array.from({ length: concurrent }, () => cacheAside(coldKey)))
  const coldDbCalls = dbCalls

  dbCalls = 0
  for (let index = 0; index < 100; index += 1) await cacheAside(coldKey)
  const warmDbCalls = dbCalls

  console.log(`cache-lru=${cacheLru}`)
  console.log(`cache-maxmemory=${cacheMaxmemory}`)
  console.log(`warmed=${warmed}`)
  console.log(`ttl-distinct=${ttlValues.size}`)
  console.log(`concurrent=${concurrent}`)
  console.log(`db-calls=${coldDbCalls}`)
  console.log(`db-calls-warm=${warmDbCalls}`)

  if (!(cacheLru === 1 && cacheMaxmemory === 1 && warmed >= 50 && ttlValues.size >= 5 &&
        concurrent >= 20 && coldDbCalls === 1 && warmDbCalls === 0)) process.exitCode = 1
} finally {
  await deleteNamespace(redis, PREFIX)
  await redis.quit()
  await pool.end()
}
