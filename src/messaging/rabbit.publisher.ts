import {
    Injectable,
    Logger,
    OnModuleDestroy
} from '@nestjs/common'

import amqp, {
    type ConfirmChannel
} from 'amqplib'

import {
    SHOP_EVENTS_EXCHANGE,
    ORDER_PLACED_ROUTING_KEY
} from './rabbit.constants.js'

import type {
    OrderPlacedEvent
} from './order-placed.event.js'

@Injectable()
export class RabbitPublisher
    implements OnModuleDestroy {
    private readonly logger =
        new Logger(
            RabbitPublisher.name
        )

    private connection:
        Awaited<
            ReturnType<
                typeof amqp.connect
            >
        > | undefined

    private channel:
        ConfirmChannel | undefined

    private async getChannel():
        Promise<ConfirmChannel | null> {
        const brokerUrl =
            process.env.BROKER_URL

        /*
         * Старі тести не піднімають RabbitMQ.
         * Тому без BROKER_URL broker layer
         * просто вимкнений.
         */
        if (!brokerUrl) {
            return null
        }

        if (this.channel) {
            return this.channel
        }

        this.connection =
            await amqp.connect(
                brokerUrl
            )

        this.channel =
            await this.connection
                .createConfirmChannel()

        return this.channel
    }

    async publishOrderPlaced(
        event: OrderPlacedEvent
    ): Promise<void> {
        const channel =
            await this.getChannel()

        if (!channel) {
            this.logger.warn(
                'BROKER_URL is not set; order.placed was not published'
            )

            return
        }

        let returned = false

        const onReturn = () => {
            returned = true
        }

        channel.once(
            'return',
            onReturn
        )

        try {
            channel.publish(
                SHOP_EVENTS_EXCHANGE,
                ORDER_PLACED_ROUTING_KEY,
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
                        event.type,

                    timestamp:
                        Date.now()
                }
            )

            await channel
                .waitForConfirms()

            if (returned) {
                throw new Error(
                    'order.placed was returned as unroutable'
                )
            }
        }
        finally {
            channel.removeListener(
                'return',
                onReturn
            )
        }
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