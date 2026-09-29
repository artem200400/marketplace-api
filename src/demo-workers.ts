import 'reflect-metadata'

import AppDataSource
    from './data-source.js'

type JobRow = {
    id: string
}

type WorkerStat = {
    worker: string
    processed: number
}

const WORKER_COUNT = 3
const JOB_COUNT = 12
const JOB_DURATION_MS = 150

function sleep(
    ms: number
): Promise<void> {
    return new Promise(
        resolve =>
            setTimeout(
                resolve,
                ms
            )
    )
}

async function seedJobs(): Promise<void> {
    await AppDataSource.transaction(
        async manager => {
            await manager.query(
                `
                DELETE FROM job_queue
                `
            )

            for (
                let i = 1;
                i <= JOB_COUNT;
                i++
            ) {
                await manager.query(
                    `
                    INSERT INTO job_queue (
                        type,
                        payload,
                        status,
                        processed
                    )
                    VALUES (
                        'worker-demo',
                        $1::jsonb,
                        'pending',
                        0
                    )
                    `,
                    [
                        JSON.stringify({
                            number: i
                        })
                    ]
                )
            }
        }
    )
}

async function runWorker(
    workerName: string
): Promise<WorkerStat> {
    let processed = 0

    while (true) {
        let gotJob = false

        await AppDataSource.transaction(
            async manager => {
                const result =
                    await manager.query(
                        `
                        SELECT id
                        FROM job_queue
                        WHERE status = 'pending'
                        ORDER BY id
                        FOR UPDATE SKIP LOCKED
                        LIMIT 1
                        `
                    )

                const rows =
                    Array.isArray(result) &&
                    Array.isArray(result[0])
                        ? result[0] as JobRow[]
                        : result as JobRow[]

                if (rows.length === 0) {
                    return
                }

                gotJob = true

                const job =
                    rows[0]

                await sleep(
                    JOB_DURATION_MS
                )

                await manager.query(
                    `
                    UPDATE job_queue
                    SET
                        status = 'done',
                        processed = processed + 1,
                        processed_by = $1,
                        processed_at = now()
                    WHERE id = $2
                    `,
                    [
                        workerName,
                        job.id
                    ]
                )

                processed++
            }
        )

        if (!gotJob) {
            const pendingResult =
                await AppDataSource.query(
                    `
                    SELECT COUNT(*)::int AS count
                    FROM job_queue
                    WHERE status = 'pending'
                    `
                )

            const rows =
                Array.isArray(
                    pendingResult
                ) &&
                Array.isArray(
                    pendingResult[0]
                )
                    ? pendingResult[0]
                    : pendingResult

            const pending =
                Number(
                    rows[0]?.count ?? 0
                )

            if (pending === 0) {
                break
            }

            await sleep(25)
        }
    }

    return {
        worker:
            workerName,
        processed
    }
}

async function main(): Promise<void> {
    await AppDataSource.initialize()

    try {
        await seedJobs()

        console.log('')
        console.log(
            '=== WORKER POOL DEMO ==='
        )

        console.log(
            `Workers: ${WORKER_COUNT}`
        )

        console.log(
            `Jobs: ${JOB_COUNT}`
        )

        console.log(
            `Job duration: ${JOB_DURATION_MS} ms`
        )

        const start =
            Date.now()

        const workers =
            Array.from(
                {
                    length:
                        WORKER_COUNT
                },
                (_, index) =>
                    `worker-${index + 1}`
            )

        const stats =
            await Promise.all(
                workers.map(
                    worker =>
                        runWorker(
                            worker
                        )
                )
            )

        const elapsed =
            Date.now() -
            start

        const processedTwiceResult =
            await AppDataSource.query(
                `
                SELECT COUNT(*)::int AS count
                FROM job_queue
                WHERE processed > 1
                `
            )

        const processedTwiceRows =
            Array.isArray(
                processedTwiceResult
            ) &&
            Array.isArray(
                processedTwiceResult[0]
            )
                ? processedTwiceResult[0]
                : processedTwiceResult

        const processedTwice =
            Number(
                processedTwiceRows[0]
                    ?.count ?? 0
            )

        const doneResult =
            await AppDataSource.query(
                `
                SELECT COUNT(*)::int AS count
                FROM job_queue
                WHERE status = 'done'
                `
            )

        const doneRows =
            Array.isArray(
                doneResult
            ) &&
            Array.isArray(
                doneResult[0]
            )
                ? doneResult[0]
                : doneResult

        const doneCount =
            Number(
                doneRows[0]
                    ?.count ?? 0
            )

        console.log('')
        console.log(
            'Worker distribution:'
        )

        for (
            const stat
            of stats
        ) {
            console.log(
                `${stat.worker}: ${stat.processed}`
            )
        }

        console.log('')
        console.log(
            `Done jobs: ${doneCount}`
        )

        console.log(
            `Processed twice: ${processedTwice}`
        )

        console.log(
            `Total time: ${elapsed} ms`
        )

        const sequentialTime =
            JOB_COUNT *
            JOB_DURATION_MS

        console.log(
            `Sequential estimate: ${sequentialTime} ms`
        )

        const activeWorkers =
            stats.filter(
                stat =>
                    stat.processed > 0
            ).length

        const invariantOk =
            activeWorkers >= 2 &&
            doneCount ===
                JOB_COUNT &&
            processedTwice === 0 &&
            elapsed <
                sequentialTime

        console.log('')

        if (!invariantOk) {
            console.error(
                'WORKER INVARIANT FAILED'
            )

            process.exitCode = 1
            return
        }

        console.log(
            'Worker invariant OK'
        )
    } finally {
        await AppDataSource.destroy()
    }
}

main().catch(error => {
    console.error(
        'Worker demo failed'
    )

    console.error(error)

    process.exit(1)
})