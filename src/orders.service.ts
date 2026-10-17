import {
    BadRequestException,
    Injectable,
    NotFoundException
} from '@nestjs/common'

import {
    DatabaseService
} from './database/database.service.js'

import {
    OrderEventsService
} from './order-events.service.js'

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
            OrderEventsService
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

        /*
         * ВАЖЛИВО:
         * подія народжується саме в бізнес-логіці,
         * а не в controller.
         */
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
}