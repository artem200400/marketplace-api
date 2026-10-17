import {
    Injectable,
    Logger,
    OnModuleDestroy,
    OnModuleInit
} from '@nestjs/common'

import amqp, {
    type Channel,
    type ConsumeMessage
} from 'amqplib'

import {
    DatabaseService
} from '../database/database.service.js'

import {
    DEAD_LETTER_EXCHANGE,
    DEAD_LETTER_QUEUE,
    DEAD_LETTER_ROUTING_KEY,
    ORDER_PLACED_QUEUE,
    ORDER_PLACED_ROUTING_KEY,
    RABBIT_PREFETCH,
    SHOP_EVENTS_EXCHANGE
} from './rabbit.constants.js'

import type {
    OrderPlacedEvent
} from './order-placed.event.js'

@Injectable()
export class RabbitConsumer
    implements
    OnModuleInit,
    OnModuleDestroy {
    private readonly logger =
        new Logger(
            RabbitConsumer.name
        )

    private connection:
        Awaited<
            ReturnType<
                typeof amqp.connect
            >
        > | undefined

    private channel:
        Channel | undefined

    constructor(
        private readonly database:
            DatabaseService
    ) { }

    async onModuleInit() {
        const brokerUrl =
            process.env.BROKER_URL

        /*
         * Integration/E2E tests from previous
         * homework do not start RabbitMQ.
         */
        if (!brokerUrl) {
            this.logger.warn(
                'BROKER_URL is not set; RabbitMQ consumer is disabled'
            )

            return
        }

        this.connection =
            await amqp.connect(
                brokerUrl
            )

        this.channel =
            await this.connection
                .createChannel()

        await this.assertTopology(
            this.channel
        )

        await this.channel.prefetch(
            RABBIT_PREFETCH
        )

        await this.prepareDatabase()

        await this.channel.consume(
            ORDER_PLACED_QUEUE,
            message => {
                void this.handleMessage(
                    message
                )
            },
            {
                noAck:
                    false
            }
        )

        this.logger.log(
            `Listening for ${ORDER_PLACED_ROUTING_KEY}, prefetch=${RABBIT_PREFETCH}`
        )
    }

    private async assertTopology(
        channel: Channel
    ) {
        await channel.assertExchange(
            SHOP_EVENTS_EXCHANGE,
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
            ORDER_PLACED_QUEUE,
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
            ORDER_PLACED_QUEUE,
            SHOP_EVENTS_EXCHANGE,
            ORDER_PLACED_ROUTING_KEY
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

    private async prepareDatabase() {
        await this.database.query(
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

    private async handleMessage(
        message:
            ConsumeMessage | null
    ) {
        if (
            !message ||
            !this.channel
        ) {
            return
        }

        try {
            const event =
                JSON.parse(
                    message
                        .content
                        .toString(
                            'utf8'
                        )
                ) as OrderPlacedEvent

            this.validateEvent(
                event
            )

            const applied =
                await this.applyEffect(
                    event
                )

            if (applied) {
                this.logger.log(
                    `Applied ${event.type} ${event.eventId}`
                )
            }
            else {
                this.logger.log(
                    `Skipped duplicate ${event.eventId}`
                )
            }

            /*
             * ACK ONLY AFTER the effect.
             */
            this.channel.ack(
                message
            )
        }
        catch (error) {
            this.logger.error(
                error instanceof Error
                    ? error.message
                    : String(
                        error
                    )
            )

            /*
             * Poison message:
             * no requeue -> DLX/DLQ.
             */
            this.channel.reject(
                message,
                false
            )
        }
    }

    private validateEvent(
        event: OrderPlacedEvent
    ) {
        if (
            !event ||
            typeof event.eventId !==
            'string' ||
            event.type !==
            'order.placed' ||
            typeof event.occurredAt !==
            'string' ||
            !event.data ||
            typeof event.data.orderId !==
            'string' ||
            typeof event.data.userId !==
            'string' ||
            typeof event.data.totalCents !==
            'number'
        ) {
            throw new Error(
                'Invalid order.placed event'
            )
        }
    }

    private async applyEffect(
        event: OrderPlacedEvent
    ): Promise<boolean> {
        /*
         * Persistent deduplication.
         *
         * The event effect can be attempted
         * many times, but event_id can only
         * be inserted once.
         */
        const result =
            await this.database.query<{
                event_id: string
            }>(
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
                RETURNING event_id::text
                `,
                [
                    event.eventId,
                    event.data.orderId,
                    event.type
                ]
            )

        return (
            result.rowCount === 1
        )
    }

    async onModuleDestroy() {
        if (this.channel) {
            await this.channel
                .close()
                .catch(
                    () =>
                        undefined
                )
        }

        if (this.connection) {
            await this.connection
                .close()
                .catch(
                    () =>
                        undefined
                )
        }
    }
}