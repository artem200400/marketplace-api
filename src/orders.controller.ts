import { Req, UseGuards, ForbiddenException, UnprocessableEntityException, ConflictException } from '@nestjs/common'
import { AccessGuard, AdminGuard } from './auth/auth.service.js'
import type { AuthenticatedRequest } from './auth/auth.service.js'
import { inTransaction, placeOrder } from './outbox/order-service.js'
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
@UseGuards(AccessGuard)
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
        body: CreateOrderBody,

        @Req()
        req: AuthenticatedRequest
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
            body.items.length === 0
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

        const user = { id: req.principal!.id }

        try {
            const order = await this.database.withClient(client =>
                inTransaction(client, () => placeOrder(client, {
                    userId: user.id,
                    idempotencyKey,
                    items: body.items
                }))
            )
            return {
                ...order,
                user_id: user.id,
                status: (await this.orders.findOrderOwner(order.id))?.status ?? 'pending'
            }
        } catch (error) {
            if (error instanceof Error && error.message === 'OUT_OF_STOCK') {
                throw new ConflictException(error.message)
            }
            if (error instanceof Error && error.message === 'IDEMPOTENCY_CONFLICT') {
                throw new UnprocessableEntityException(error.message)
            }
            if (error instanceof Error &&
                /^(INVALID_|PRODUCT_NOT_FOUND|IDEMPOTENCY_)/.test(error.message)) {
                throw new BadRequestException(error.message)
            }
            throw error
        }
    }

    @Patch(':id/status')
    @UseGuards(AdminGuard)
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

    @Get(':id/events')
    async events(
        @Param('id')
        id: string,

        @Headers('last-event-id')
        lastEventIdHeader:
            string | undefined,

        @Res()
        response: Response,

        @Req()
        req: AuthenticatedRequest
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

        if (order.user_id !== req.principal!.id && req.principal!.role !== 'ADMIN') {
            throw new ForbiddenException('Order belongs to another user')
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
        id: string,
        @Req() req: AuthenticatedRequest
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

        if (order.user_id !== req.principal!.id && req.principal!.role !== 'ADMIN') {
            throw new ForbiddenException('Order belongs to another user')
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