import { Queue, Worker } from 'bullmq'
import { bullConnection, queueRedis, sleep, waitUntil } from './redis-utils.mjs'

const QUEUE_NAME = 'hw23-jobs'
const SCHEDULER_ID = 'hw23-scheduler'
const redis = queueRedis()
const queue = new Queue(QUEUE_NAME, { connection: bullConnection(false) })
let worker

try {
  const policy = await redis.config('GET', 'maxmemory-policy')
  const queueNoEviction = String(policy[1]) === 'noeviction' ? 1 : 0

  await queue.removeJobScheduler(SCHEDULER_ID).catch(() => undefined)
  await queue.obliterate({ force: true }).catch(() => undefined)

  const added = 2
  const jobOptions = {
    jobId: 'hw23-dedup-job',
    attempts: 3,
    backoff: { type: 'exponential', delay: 100, jitter: 0.2 },
    removeOnComplete: { age: 3600 },
    removeOnFail: { age: 3600 }
  }

  await queue.add('retry-job', { source: 'first' }, jobOptions)
  await queue.add('retry-job', { source: 'duplicate' }, jobOptions)
  const queued = await queue.getWaitingCount()

  let attempts = 0
  let completed = 0
  let scheduledRuns = 0

  worker = new Worker(QUEUE_NAME, async job => {
    if (job.name === 'retry-job') {
      attempts += 1
      if (attempts < 3) throw new Error(`Intentional failure ${attempts}`)
      completed = 1
      return { ok: true }
    }

    if (job.name === 'scheduled-job') {
      scheduledRuns += 1
      return { scheduled: true }
    }

    return { ignored: true }
  }, {
    connection: bullConnection(true),
    concurrency: 2
  })

  await waitUntil(() => completed === 1, 10000)

  await queue.upsertJobScheduler(
    SCHEDULER_ID,
    { every: 1000 },
    {
      name: 'scheduled-job',
      data: { source: 'hw23' },
      opts: {
        removeOnComplete: { age: 60 },
        removeOnFail: { age: 60 }
      }
    }
  )

  await waitUntil(() => scheduledRuns >= 2, 10000)
  const schedulers = (await queue.getJobSchedulers()).length

  console.log(`queue-noeviction=${queueNoEviction}`)
  console.log(`attempts=${attempts}`)
  console.log(`completed=${completed}`)
  console.log(`added=${added}`)
  console.log(`queued=${queued}`)
  console.log(`schedulers=${schedulers}`)
  console.log(`scheduled-runs=${scheduledRuns}`)

  if (!(queueNoEviction === 1 && attempts >= 3 && completed === 1 && added === 2 &&
        queued === 1 && schedulers >= 1 && scheduledRuns >= 2)) process.exitCode = 1

  await sleep(100)
} finally {
  await queue.removeJobScheduler(SCHEDULER_ID).catch(() => undefined)
  if (worker) await worker.close()
  await queue.obliterate({ force: true }).catch(() => undefined)
  await queue.close()
  await redis.quit()
}
