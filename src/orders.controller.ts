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
    Post
} from '@nestjs/common'

import {
    DatabaseService
} from './database/database.service.js'

type CreateOrderBody = {
    items: Array<{
        product_id: string
        quantity: number
    }>
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
            DatabaseService
    ) { }

    @Post()
    @HttpCode(201)
    async createOrder(
        @Headers('idempotency-key')
        idempotencyKey: string | undefined,

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
            !Array.isArray(body.items) ||
            body.items.length === 0
        ) {
            throw new BadRequestException(
                'items must contain at least one item'
            )
        }

        for (const item of body.items) {
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

        try {
            return await this.database.withClient(client =>
                inTransaction(client, () => placeOrder(client, {
                    userId: user.id,
                    idempotencyKey,
                    items: body.items
                }))
            )
        } catch (error) {
            if (error instanceof Error &&
                /^(INVALID_|PRODUCT_NOT_FOUND|IDEMPOTENCY_)/.test(error.message)) {
                throw new BadRequestException(error.message)
            }
            throw error
        }
    }

    @Get(':id')
    async getOrder(
        @Param('id')
        id: string
    ) {
        const orderResult =
            await this.database
                .query<OrderRow>(
                    `
                    SELECT
                        id::text,
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

            items:
                itemsResult.rows,

            total_cents:
                order.total_amount_cents,

            created_at:
                order.created_at
                    .toISOString()
        }
    }
}