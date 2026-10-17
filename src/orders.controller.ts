import {
    BadRequestException,
    Body,
    Controller,
    Get,
    Headers,
    HttpCode,
    NotFoundException,
    Param,
    Patch,
    Post,
    Res
} from '@nestjs/common'

import type {
    Response
} from 'express'

import type {
    Subscription
} from 'rxjs'

import {
    DatabaseService
} from './database/database.service.js'

import {
    OrderEventsService
} from './order-events.service.js'

import {
    OrdersService
} from './orders.service.js'

type CreateOrderBody = {
    items: Array<{
        product_id: string
        quantity: number
    }>
}

type UpdateStatusBody = {
    status: string
}

type ProductPriceRow = {
    id: string
    price_cents: number
}

type OrderRow = {
    id: string
    total_amount_cents: number
    created_at: Date
}

type OrderItemRow = {
    product_id: string
    quantity: number
    unit_price_cents: number
}

@Controller('orders')
export class OrdersController {
    constructor(
        private readonly database:
            DatabaseService,

        private readonly orders:
            OrdersService,

        private readonly orderEvents:
            OrderEventsService
    ) { }

    @Post()
    @HttpCode(201)
    async createOrder(
        @Headers('idempotency-key')
        idempotencyKey:
            string | undefined,

        @Body()
        body: CreateOrderBody
    ) {
        if (!idempotencyKey) {
            throw new BadRequestException(
                'Idempotency-Key is required'
            )
        }

        if (
            !body ||
            !Array.isArray(
                body.items
            ) ||
            body.items.length ===
            0
        ) {
            throw new BadRequestException(
                'items must contain at least one item'
            )
        }

        for (
            const item
            of body.items
        ) {
            if (
                !item.product_id ||
                !Number.isInteger(
                    item.quantity
                ) ||
                item.quantity < 1
            ) {
                throw new BadRequestException(
                    'Invalid order item'
                )
            }
        }

        const userResult =
            await this.database.query<{
                id: string
            }>(
                `
                SELECT id::text
                FROM users
                ORDER BY id
                LIMIT 1
                `
            )

        const user =
            userResult.rows[0]

        if (!user) {
            throw new BadRequestException(
                'No marketplace user exists'
            )
        }

        const resolvedItems:
            Array<{
                product_id: string
                quantity: number
                unit_price_cents: number
            }> = []

        for (
            const item
            of body.items
        ) {
            const productResult =
                await this.database
                    .query<ProductPriceRow>(
                        `
                        SELECT
                            id::text,
                            price_cents
                        FROM products
                        WHERE id = $1
                        `,
                        [
                            item.product_id
                        ]
                    )

            const product =
                productResult.rows[0]

            if (!product) {
                throw new BadRequestException(
                    `Product ${item.product_id} does not exist`
                )
            }

            resolvedItems.push({
                product_id:
                    product.id,

                quantity:
                    item.quantity,

                unit_price_cents:
                    product.price_cents
            })
        }

        const totalCents =
            resolvedItems.reduce(
                (
                    total,
                    item
                ) =>
                    total +
                    item.unit_price_cents *
                    item.quantity,
                0
            )

        const orderResult =
            await this.database
                .query<OrderRow>(
                    `
                    INSERT INTO orders (
                        user_id,
                        status,
                        total_amount_cents
                    )
                    VALUES (
                        $1,
                        'pending',
                        $2
                    )
                    RETURNING
                        id::text,
                        total_amount_cents,
                        created_at
                    `,
                    [
                        user.id,
                        totalCents
                    ]
                )

        const order =
            orderResult.rows[0]

        for (
            const item
            of resolvedItems
        ) {
            await this.database.query(
                `
                INSERT INTO order_items (
                    order_id,
                    product_id,
                    quantity,
                    unit_price_cents
                )
                VALUES (
                    $1,
                    $2,
                    $3,
                    $4
                )
                `,
                [
                    order.id,
                    item.product_id,
                    item.quantity,
                    item.unit_price_cents
                ]
            )
        }

        return {
            id:
                order.id,

            user_id:
                user.id,

            status:
                'pending',

            items:
                resolvedItems,

            total_cents:
                order
                    .total_amount_cents,

            created_at:
                order
                    .created_at
                    .toISOString()
        }
    }

    @Patch(':id/status')
    async updateStatus(
        @Param('id')
        id: string,

        @Body()
        body: UpdateStatusBody
    ) {
        if (
            !body ||
            typeof body.status !==
            'string'
        ) {
            throw new BadRequestException(
                'status is required'
            )
        }

        return this.orders
            .updateStatus(
                id,
                body.status
            )
    }

    /*
     * SSE endpoint
     *
     * Ми використовуємо ручний Response,
     * щоб повністю контролювати:
     *
     * id:
     * event:
     * data:
     *
     * і replay через Last-Event-ID.
     */
    @Get(':id/events')
    async events(
        @Param('id')
        id: string,

        @Headers('last-event-id')
        lastEventIdHeader:
            string | undefined,

        @Res()
        response: Response
    ) {
        const order =
            await this.orders
                .findOrderOwner(
                    id
                )

        if (!order) {
            response
                .status(404)
                .json({
                    message:
                        `Order ${id} was not found`
                })

            return
        }

        response.writeHead(
            200,
            {
                'Content-Type':
                    'text/event-stream',

                'Cache-Control':
                    'no-cache',

                Connection:
                    'keep-alive',

                'X-Accel-Buffering':
                    'no'
            }
        )

        /*
         * Підказка із завдання:
         * задаємо короткий reconnect interval.
         */
        response.write(
            'retry: 1000\n\n'
        )

        const parsedLastEventId =
            Number.parseInt(
                lastEventIdHeader ??
                '0',
                10
            )

        const lastEventId =
            Number.isFinite(
                parsedLastEventId
            )
                ? parsedLastEventId
                : 0

        const missedEvents =
            this.orderEvents
                .getMissedEvents(
                    id,
                    lastEventId
                )

        for (
            const event
            of missedEvents
        ) {
            this.writeSseEvent(
                response,
                event
            )
        }

        const subscription:
            Subscription =
            this.orderEvents
                .events$
                .subscribe(
                    event => {
                        if (
                            event.orderId !==
                            id
                        ) {
                            return
                        }

                        this.writeSseEvent(
                            response,
                            event
                        )
                    }
                )

        response.on(
            'close',
            () => {
                subscription
                    .unsubscribe()

                if (
                    !response
                        .writableEnded
                ) {
                    response.end()
                }
            }
        )
    }

    @Get(':id')
    async getOrder(
        @Param('id')
        id: string
    ) {
        const orderResult =
            await this.database
                .query<OrderRow & {
                    status: string
                    user_id: string
                }>(
                    `
                    SELECT
                        id::text,
                        user_id::text,
                        status,
                        total_amount_cents,
                        created_at
                    FROM orders
                    WHERE id = $1
                    `,
                    [
                        id
                    ]
                )

        const order =
            orderResult.rows[0]

        if (!order) {
            throw new NotFoundException(
                `Order ${id} was not found`
            )
        }

        const itemsResult =
            await this.database
                .query<OrderItemRow>(
                    `
                    SELECT
                        product_id::text,
                        quantity,
                        unit_price_cents
                    FROM order_items
                    WHERE order_id = $1
                    ORDER BY id
                    `,
                    [
                        id
                    ]
                )

        return {
            id:
                order.id,

            user_id:
                order.user_id,

            status:
                order.status,

            items:
                itemsResult.rows,

            total_cents:
                order
                    .total_amount_cents,

            created_at:
                order
                    .created_at
                    .toISOString()
        }
    }

    private writeSseEvent(
        response: Response,

        event: {
            id: number
            orderId: string
            status: string
            createdAt: string
        }
    ) {
        response.write(
            `id: ${event.id}\n`
        )

        response.write(
            'event: order.status\n'
        )

        response.write(
            `data: ${JSON.stringify({
                orderId:
                    event.orderId,

                status:
                    event.status,

                createdAt:
                    event.createdAt
            })}\n\n`
        )
    }
}