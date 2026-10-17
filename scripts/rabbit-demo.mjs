import amqp from 'amqplib'
import pg from 'pg'
import {
    randomUUID
} from 'node:crypto'
import {
    readFile
} from 'node:fs/promises'

const {
    Pool
} = pg

const mode =
    process.argv[2]

if (
    ![
        'publish',
        'dlq',
        'duplicate'
    ].includes(mode)
) {
    console.error(
        'Usage: rabbit-demo.mjs publish|dlq|duplicate'
    )

    process.exit(1)
}

const brokerUrl =
    process.env.BROKER_URL

if (!brokerUrl) {
    console.error(
        'BROKER_URL is required'
    )

    process.exit(1)
}

const EXCHANGE =
    'shop.events'

const ROUTING_KEY =
    'order.placed'

const WORK_QUEUE =
    'marketplace.order.placed'

const DEAD_LETTER_EXCHANGE =
    'shop.events.dlx'

const DEAD_LETTER_QUEUE =
    'marketplace.order.placed.dlq'

const DEAD_LETTER_ROUTING_KEY =
    'dead.order.placed'

const PREFETCH =
    10

function sleep(
    milliseconds
) {
    return new Promise(
        resolve =>
            setTimeout(
                resolve,
                milliseconds
            )
    )
}

async function waitUntil(
    check,
    timeoutMs = 10000
) {
    const started =
        Date.now()

    while (
        Date.now() -
        started <
        timeoutMs
    ) {
        if (await check()) {
            return
        }

        await sleep(100)
    }

    throw new Error(
        'Timed out waiting for invariant'
    )
}

async function databaseConfig() {
    if (
        process.env.DATABASE_URL
    ) {
        return {
            connectionString:
                process.env.DATABASE_URL
        }
    }

    if (
        process.env.DB_URL
    ) {
        return {
            connectionString:
                process.env.DB_URL
        }
    }

    const passwordFile =
        process.env
            .DB_PASSWORD_FILE ??
        'secrets/db_password'

    const password =
        (
            await readFile(
                passwordFile,
                'utf8'
            )
        ).trim()

    return {
        host:
            process.env.DB_HOST ??
            '127.0.0.1',

        port:
            Number(
                process.env.DB_PORT ??
                6432
            ),

        database:
            process.env.DB_NAME ??
            'marketplace',

        user:
            process.env.DB_USER ??
            'marketplace_user',

        password
    }
}

async function createPool() {
    return new Pool(
        await databaseConfig()
    )
}

async function assertTopology(
    channel
) {
    await channel.assertExchange(
        EXCHANGE,
        'topic',
        {
            durable:
                true
        }
    )

    await channel.assertExchange(
        DEAD_LETTER_EXCHANGE,
        'topic',
        {
            durable:
                true
        }
    )

    await channel.assertQueue(
        WORK_QUEUE,
        {
            durable:
                true,

            arguments: {
                'x-queue-type':
                    'quorum',

                'x-dead-letter-exchange':
                    DEAD_LETTER_EXCHANGE,

                'x-dead-letter-routing-key':
                    DEAD_LETTER_ROUTING_KEY
            }
        }
    )

    await channel.bindQueue(
        WORK_QUEUE,
        EXCHANGE,
        ROUTING_KEY
    )

    await channel.assertQueue(
        DEAD_LETTER_QUEUE,
        {
            durable:
                true,

            arguments: {
                'x-queue-type':
                    'quorum'
            }
        }
    )

    await channel.bindQueue(
        DEAD_LETTER_QUEUE,
        DEAD_LETTER_EXCHANGE,
        DEAD_LETTER_ROUTING_KEY
    )
}

async function prepareDatabase(
    pool
) {
    await pool.query(
        `
        CREATE TABLE IF NOT EXISTS order_event_effects (
            event_id UUID PRIMARY KEY,
            order_id TEXT NOT NULL,
            event_type TEXT NOT NULL,
            processed_at TIMESTAMPTZ NOT NULL
                DEFAULT NOW()
        )
        `
    )
}

async function resetState(
    channel,
    pool
) {
    await channel.purgeQueue(
        WORK_QUEUE
    )

    await channel.purgeQueue(
        DEAD_LETTER_QUEUE
    )

    await pool.query(
        `
        DELETE
        FROM order_event_effects
        `
    )
}

async function applyEffect(
    pool,
    event
) {
    const result =
        await pool.query(
            `
            INSERT INTO order_event_effects (
                event_id,
                order_id,
                event_type
            )
            VALUES (
                $1,
                $2,
                $3
            )
            ON CONFLICT (
                event_id
            )
            DO NOTHING
            RETURNING event_id
            `,
            [
                event.eventId,
                String(
                    event.data.orderId
                ),
                event.type
            ]
        )

    return (
        result.rowCount === 1
    )
}

function buildEvent(
    extra = {}
) {
    return {
        eventId:
            randomUUID(),

        type:
            'order.placed',

        occurredAt:
            new Date()
                .toISOString(),

        data: {
            orderId:
                `demo-${randomUUID()}`,

            userId:
                'demo-user',

            totalCents:
                1000
        },

        ...extra
    }
}

async function publishConfirmed(
    channel,
    event
) {
    let returned = false

    const onReturn =
        () => {
            returned = true
        }

    channel.once(
        'return',
        onReturn
    )

    channel.publish(
        EXCHANGE,
        ROUTING_KEY,
        Buffer.from(
            JSON.stringify(
                event
            )
        ),
        {
            persistent:
                true,

            mandatory:
                true,

            contentType:
                'application/json',

            messageId:
                event.eventId,

            type:
                event.type
        }
    )

    await channel
        .waitForConfirms()

    channel.removeListener(
        'return',
        onReturn
    )

    if (returned) {
        throw new Error(
            'Message was returned as unroutable'
        )
    }
}

function parseMessage(
    message
) {
    return JSON.parse(
        message.content
            .toString(
                'utf8'
            )
    )
}

async function runPublish() {
    const connection =
        await amqp.connect(
            brokerUrl
        )

    const channel =
        await connection
            .createConfirmChannel()

    const pool =
        await createPool()

    let delivered = 0
    let effect = 0
    let acked = 0

    try {
        await assertTopology(
            channel
        )

        await channel.prefetch(
            PREFETCH
        )

        await prepareDatabase(
            pool
        )

        await resetState(
            channel,
            pool
        )

        await channel.consume(
            WORK_QUEUE,
            async message => {
                if (!message) {
                    return
                }

                delivered += 1

                try {
                    const event =
                        parseMessage(
                            message
                        )

                    const applied =
                        await applyEffect(
                            pool,
                            event
                        )

                    if (applied) {
                        effect += 1
                    }

                    channel.ack(
                        message
                    )

                    acked += 1
                }
                catch {
                    channel.reject(
                        message,
                        false
                    )
                }
            },
            {
                noAck:
                    false
            }
        )

        for (
            let index = 0;
            index < 5;
            index += 1
        ) {
            await publishConfirmed(
                channel,
                buildEvent()
            )
        }

        await waitUntil(
            () =>
                acked === 5
        )

        const work =
            await channel
                .checkQueue(
                    WORK_QUEUE
                )

        const dlqState =
            await channel
                .checkQueue(
                    DEAD_LETTER_QUEUE
                )

        const published = 5
        const dlq =
            dlqState.messageCount

        console.log(
            `published=${published}`
        )

        console.log(
            `delivered=${delivered}`
        )

        console.log(
            `effect=${effect}`
        )

        console.log(
            `acked=${acked}`
        )

        console.log(
            `dlq=${dlq}`
        )

        console.log(
            `prefetch=${PREFETCH}`
        )

        const ok =
            published === 5 &&
            delivered === 5 &&
            effect === 5 &&
            acked === 5 &&
            work.messageCount ===
                0 &&
            dlq === 0 &&
            PREFETCH >= 1 &&
            PREFETCH <= 2000

        if (!ok) {
            process.exitCode = 1
        }
    }
    finally {
        await pool.end()

        await channel.close()
            .catch(() => undefined)

        await connection.close()
            .catch(() => undefined)
    }
}

async function runDlq() {
    const connection =
        await amqp.connect(
            brokerUrl
        )

    const channel =
        await connection
            .createConfirmChannel()

    const pool =
        await createPool()

    let rejected = 0
    let effect = 0

    try {
        await assertTopology(
            channel
        )

        await channel.prefetch(
            PREFETCH
        )

        await prepareDatabase(
            pool
        )

        await resetState(
            channel,
            pool
        )

        await channel.consume(
            WORK_QUEUE,
            async message => {
                if (!message) {
                    return
                }

                const event =
                    parseMessage(
                        message
                    )

                if (
                    event.poison ===
                    true
                ) {
                    rejected += 1

                    channel.reject(
                        message,
                        false
                    )

                    return
                }

                const applied =
                    await applyEffect(
                        pool,
                        event
                    )

                if (applied) {
                    effect += 1
                }

                channel.ack(
                    message
                )
            },
            {
                noAck:
                    false
            }
        )

        await publishConfirmed(
            channel,
            buildEvent({
                poison:
                    true
            })
        )

        await waitUntil(
            async () => {
                const state =
                    await channel
                        .checkQueue(
                            DEAD_LETTER_QUEUE
                        )

                return (
                    state.messageCount ===
                    1
                )
            }
        )

        const dlqMessage =
            await channel.get(
                DEAD_LETTER_QUEUE,
                {
                    noAck:
                        false
                }
            )

        if (!dlqMessage) {
            throw new Error(
                'DLQ message not found'
            )
        }

        const headers =
            dlqMessage
                .properties
                .headers ?? {}

        const xDeath =
            headers['x-death']

        let reason =
            headers[
                'x-first-death-reason'
            ]

        if (
            !reason &&
            Array.isArray(
                xDeath
            ) &&
            xDeath.length >
                0
        ) {
            reason =
                xDeath[0]
                    ?.reason
        }

        reason =
            String(
                reason ??
                ''
            )

        channel.nack(
            dlqMessage,
            false,
            true
        )

        await waitUntil(
            async () => {
                const state =
                    await channel
                        .checkQueue(
                            DEAD_LETTER_QUEUE
                        )

                return (
                    state.messageCount ===
                    1
                )
            }
        )

        const workState =
            await channel
                .checkQueue(
                    WORK_QUEUE
                )

        const dlqState =
            await channel
                .checkQueue(
                    DEAD_LETTER_QUEUE
                )

        console.log(
            `rejected=${rejected}`
        )

        console.log(
            `work=${workState.messageCount}`
        )

        console.log(
            `dlq=${dlqState.messageCount}`
        )

        console.log(
            `dlq-reason=${reason}`
        )

        console.log(
            `effect=${effect}`
        )

        const validReasons =
            new Set([
                'rejected',
                'expired',
                'maxlen',
                'delivery_limit'
            ])

        const ok =
            rejected === 1 &&
            workState.messageCount ===
                0 &&
            dlqState.messageCount ===
                1 &&
            validReasons.has(
                reason
            ) &&
            effect === 0

        if (!ok) {
            process.exitCode = 1
        }
    }
    finally {
        await pool.end()

        await channel.close()
            .catch(() => undefined)

        await connection.close()
            .catch(() => undefined)
    }
}

async function runDuplicate() {
    const connection =
        await amqp.connect(
            brokerUrl
        )

    const channel =
        await connection
            .createConfirmChannel()

    const pool =
        await createPool()

    let deliveries = 0
    let effect = 0
    let skipped = 0

    try {
        await assertTopology(
            channel
        )

        await channel.prefetch(
            PREFETCH
        )

        await prepareDatabase(
            pool
        )

        await resetState(
            channel,
            pool
        )

        let forcedRedelivery =
            false

        await channel.consume(
            WORK_QUEUE,
            async message => {
                if (!message) {
                    return
                }

                deliveries += 1

                try {
                    const event =
                        parseMessage(
                            message
                        )

                    const applied =
                        await applyEffect(
                            pool,
                            event
                        )

                    if (applied) {
                        effect += 1
                    }
                    else {
                        skipped += 1
                    }

                    if (
                        !forcedRedelivery
                    ) {
                        forcedRedelivery =
                            true

                        channel.nack(
                            message,
                            false,
                            true
                        )

                        return
                    }

                    channel.ack(
                        message
                    )
                }
                catch {
                    channel.reject(
                        message,
                        false
                    )
                }
            },
            {
                noAck:
                    false
            }
        )

        await publishConfirmed(
            channel,
            buildEvent()
        )

        await waitUntil(
            () =>
                deliveries >= 2 &&
                skipped >= 1
        )

        console.log(
            `deliveries=${deliveries}`
        )

        console.log(
            `effect=${effect}`
        )

        console.log(
            `skipped=${skipped}`
        )

        const ok =
            deliveries >= 2 &&
            effect === 1 &&
            skipped >= 1

        if (!ok) {
            process.exitCode = 1
        }
    }
    finally {
        await pool.end()

        await channel.close()
            .catch(() => undefined)

        await connection.close()
            .catch(() => undefined)
    }
}

if (
    mode ===
    'publish'
) {
    await runPublish()
}

if (
    mode ===
    'dlq'
) {
    await runDlq()
}

if (
    mode ===
    'duplicate'
) {
    await runDuplicate()
}