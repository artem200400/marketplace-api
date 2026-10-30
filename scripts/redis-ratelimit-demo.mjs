import { randomUUID } from 'node:crypto'
import { deleteNamespace, queueRedis } from './redis-utils.mjs'

const redisA = queueRedis()
const redisB = queueRedis()
const PREFIX = 'hw23:ratelimit:'
const KEY = `${PREFIX}client:demo`
const LIMIT = 5
const WINDOW_MS = 10000

const LUA = `
redis.call("ZREMRANGEBYSCORE", KEYS[1], 0, tonumber(ARGV[1]) - tonumber(ARGV[2]))
local count = redis.call("ZCARD", KEYS[1])
if count >= tonumber(ARGV[3]) then
  local oldest = redis.call("ZRANGE", KEYS[1], 0, 0, "WITHSCORES")
  local retry = tonumber(ARGV[2])
  if oldest[2] then retry = tonumber(ARGV[2]) - (tonumber(ARGV[1]) - tonumber(oldest[2])) end
  if retry < 1 then retry = 1 end
  return {0, retry}
end
redis.call("ZADD", KEYS[1], ARGV[1], ARGV[4])
redis.call("PEXPIRE", KEYS[1], ARGV[2])
return {1, 0}
`

async function checkLimit(redis) {
  const result = await redis.eval(LUA, 1, KEY, Date.now(), WINDOW_MS, LIMIT, randomUUID())
  if (Number(result[0]) === 1) return { status: 200, retryAfter: null }
  return { status: 429, retryAfter: Math.max(1, Math.ceil(Number(result[1]) / 1000)) }
}

try {
  await deleteNamespace(redisA, PREFIX)
  const instances = 2
  const requests = 8
  let allowed = 0
  let blocked = 0
  let lastStatus = 200
  let retryAfterHeader = 0

  for (let index = 0; index < requests; index += 1) {
    const result = await checkLimit(index % 2 === 0 ? redisA : redisB)
    lastStatus = result.status
    if (result.status === 200) allowed += 1
    else {
      blocked += 1
      if (result.retryAfter !== null) retryAfterHeader = 1
    }
  }

  console.log(`instances=${instances}`)
  console.log(`limit=${LIMIT}`)
  console.log(`requests=${requests}`)
  console.log(`allowed=${allowed}`)
  console.log(`blocked=${blocked}`)
  console.log(`status=${lastStatus}`)
  console.log(`retry-after=${retryAfterHeader}`)

  if (!(instances >= 2 && allowed === LIMIT && blocked >= 1 && lastStatus === 429 && retryAfterHeader === 1)) {
    process.exitCode = 1
  }
} finally {
  await deleteNamespace(redisA, PREFIX)
  await redisA.quit()
  await redisB.quit()
}
