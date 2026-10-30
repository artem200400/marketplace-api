import IORedis from 'ioredis'
import pg from 'pg'
import { readFile } from 'node:fs/promises'

const { Pool } = pg

export function cacheRedis() {
  const url = process.env.REDIS_URL
  if (!url) throw new Error('REDIS_URL is required')
  return new IORedis(url)
}

export function queueRedis(worker = false) {
  const url = process.env.REDIS_QUEUE_URL
  if (!url) throw new Error('REDIS_QUEUE_URL is required')
  return new IORedis(url, { maxRetriesPerRequest: worker ? null : 20 })
}

export function bullConnection(worker = false) {
  const value = process.env.REDIS_QUEUE_URL
  if (!value) throw new Error('REDIS_QUEUE_URL is required')
  const url = new URL(value)
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password || undefined,
    db: url.pathname && url.pathname !== '/' ? Number(url.pathname.slice(1)) : 0,
    maxRetriesPerRequest: worker ? null : 20
  }
}

export async function createPool() {
  if (process.env.DATABASE_URL) return new Pool({ connectionString: process.env.DATABASE_URL })
  if (process.env.DB_URL) return new Pool({ connectionString: process.env.DB_URL })

  const passwordFile = process.env.DB_PASSWORD_FILE ?? 'secrets/db_password'
  const password = (await readFile(passwordFile, 'utf8')).trim()
  return new Pool({
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DB_PORT ?? 6432),
    database: process.env.DB_NAME ?? 'marketplace',
    user: process.env.DB_USER ?? 'marketplace_user',
    password
  })
}

export async function deleteNamespace(redis, prefix) {
  let cursor = '0'
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 500)
    cursor = next
    if (keys.length > 0) await redis.del(...keys)
  } while (cursor !== '0')
}

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function waitUntil(check, timeout = 15000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    if (await check()) return
    await sleep(100)
  }
  throw new Error('Timed out waiting for condition')
}

export async function releaseLock(redis, key, token) {
  const lua = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("del", KEYS[1])
    end
    return 0
  `
  return redis.eval(lua, 1, key, token)
}
