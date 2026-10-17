import {
    BadRequestException,
    Injectable,
    NotFoundException
} from '@nestjs/common'

import {
    createHash
} from 'node:crypto'

import {
    DatabaseService
} from './database/database.service.js'

import {
    OrderEventsService
} from './order-events.service.js'

import {
    RabbitPublisher
} from './messaging/rabbit.publisher.js'

import type {
    OrderPlacedEvent
} from './messaging/order-placed.event.js'

export type OrderStatus =
    | 'pending'
    | 'shipped'
    | 'completed'
    | 'cancelled'

type OrderOwnerRow = {
    id: string
    user_id: string
    status: string
}

@Injectable()
export class OrdersService {
    constructor(
        private readonly database:
            DatabaseService,

        private readonly orderEvents:
            OrderEventsService,

        private readonly rabbitPublisher:
            RabbitPublisher
    ) { }

    async findOrderOwner(
        orderId: string
    ): Promise<OrderOwnerRow | null> {
        const result =
            await this.database
                .query<OrderOwnerRow>(
                    `
                    SELECT
                        id::text,
                        user_id::text,
                        status
                    FROM orders
                    WHERE id = $1
                    `,
                    [
                        orderId
                    ]
                )

        return (
            result.rows[0] ??
            null
        )
    }

    async assertOrderOwner(
        orderId: string,
        userId: string
    ): Promise<void> {
        const order =
            await this.findOrderOwner(
                orderId
            )

        if (!order) {
            throw new NotFoundException(
                `Order ${orderId} was not found`
            )
        }

        if (
            order.user_id !==
            userId
        ) {
            throw new BadRequestException(
                'This order does not belong to this user'
            )
        }
    }

    async publishOrderPlaced(
        order: {
            id: string
            userId: string
            totalCents: number
        }
    ): Promise<void> {
        /*
         * Stable eventId derived from the
         * business operation/order id.
         *
         * The same order always produces
         * the same order.placed event id.
         */
        const eventId =
            this.createStableEventId(
                `order.placed:${order.id}`
            )

        const event:
            OrderPlacedEvent = {
            eventId,

            type:
                'order.placed',

            occurredAt:
                new Date()
                    .toISOString(),

            data: {
                orderId:
                    order.id,

                userId:
                    order.userId,

                totalCents:
                    order.totalCents
            }
        }

        await this.rabbitPublisher
            .publishOrderPlaced(
                event
            )
    }

    async updateStatus(
        orderId: string,
        status: string
    ) {
        const allowedStatuses:
            OrderStatus[] = [
                'pending',
                'shipped',
                'completed',
                'cancelled'
            ]

        if (
            !allowedStatuses.includes(
                status as OrderStatus
            )
        ) {
            throw new BadRequestException(
                'Invalid order status'
            )
        }

        const result =
            await this.database.query<{
                id: string
                status: string
            }>(
                `
                UPDATE orders
                SET status = $2
                WHERE id = $1
                RETURNING
                    id::text,
                    status
                `,
                [
                    orderId,
                    status
                ]
            )

        const order =
            result.rows[0]

        if (!order) {
            throw new NotFoundException(
                `Order ${orderId} was not found`
            )
        }

        const event =
            this.orderEvents
                .publishStatus(
                    order.id,
                    order.status
                )

        return {
            id:
                order.id,

            status:
                order.status,

            event_id:
                event.id
        }
    }

    private createStableEventId(
        value: string
    ): string {
        const hash =
            createHash(
                'sha256'
            )
                .update(
                    value
                )
                .digest(
                    'hex'
                )

        /*
         * Convert deterministic SHA-256 bytes
         * into a UUID-shaped stable identifier.
         */
        const part1 =
            hash.slice(
                0,
                8
            )

        const part2 =
            hash.slice(
                8,
                12
            )

        const part3 =
            `5${hash.slice(
                13,
                16
            )}`

        const variant =
            (
                (
                    Number.parseInt(
                        hash[16],
                        16
                    ) &
                    0x3
                ) |
                0x8
            )
                .toString(
                    16
                )

        const part4 =
            `${variant}${hash.slice(
                17,
                20
            )}`

        const part5 =
            hash.slice(
                20,
                32
            )

        return [
            part1,
            part2,
            part3,
            part4,
            part5
        ].join(
            '-'
        )
    }
}