import 'reflect-metadata'

import type {
    EntityManager
} from 'typeorm'

export type CheckoutInput = {
    userId: string
    productId: string
    quantity: number
}

export type CheckoutResult = {
    orderId: string
    remainingStock: number
    remainingBalanceCents: number
}

type StockRow = {
    id: string
    price_cents: number
    stock: number
}

type BalanceRow = {
    id: string
    balance_cents: number
}

type OrderRow = {
    id: string
}

function getRows<T>(
    result: unknown
): T[] {
    if (!Array.isArray(result)) {
        return []
    }

    /*
     * Some TypeORM/Postgres versions return:
     *
     * [rows, affectedCount]
     *
     * while others return:
     *
     * rows
     */
    if (
        result.length > 0 &&
        Array.isArray(result[0])
    ) {
        return result[0] as T[]
    }

    return result as T[]
}

export async function checkout(
    manager: EntityManager,
    input: CheckoutInput
): Promise<CheckoutResult> {
    if (
        !Number.isInteger(
            input.quantity
        ) ||
        input.quantity <= 0
    ) {
        throw new Error(
            'INVALID_QUANTITY'
        )
    }

    /*
     * Atomic stock decrement.
     *
     * The check and decrement happen
     * inside the same SQL statement.
     *
     * This prevents oversell.
     */
    const stockResult =
        await manager.query(
            `
            UPDATE products
            SET stock = stock - $1
            WHERE id = $2
              AND stock >= $1
            RETURNING
                id,
                price_cents,
                stock
            `,
            [
                input.quantity,
                input.productId
            ]
        )

    const stockRows =
        getRows<StockRow>(
            stockResult
        )

    if (stockRows.length === 0) {
        throw new Error(
            'OUT_OF_STOCK'
        )
    }

    const product =
        stockRows[0]

    const totalAmountCents =
        Number(
            product.price_cents
        ) *
        input.quantity

    if (
        !Number.isInteger(
            totalAmountCents
        )
    ) {
        throw new Error(
            'INVALID_TOTAL_AMOUNT'
        )
    }

    /*
     * Atomic balance decrement.
     *
     * If balance is not sufficient,
     * the entire transaction is rolled back,
     * including the previous stock update.
     */
    const balanceResult =
        await manager.query(
            `
            UPDATE users
            SET balance_cents =
                balance_cents - $1
            WHERE id = $2
              AND balance_cents >= $1
            RETURNING
                id,
                balance_cents
            `,
            [
                totalAmountCents,
                input.userId
            ]
        )

    const balanceRows =
        getRows<BalanceRow>(
            balanceResult
        )

    if (
        balanceRows.length === 0
    ) {
        throw new Error(
            'INSUFFICIENT_BALANCE'
        )
    }

    const balance =
        balanceRows[0]

    const orderResult =
        await manager.query(
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
            RETURNING id
            `,
            [
                input.userId,
                totalAmountCents
            ]
        )

    const orderRows =
        getRows<OrderRow>(
            orderResult
        )

    if (
        orderRows.length === 0
    ) {
        throw new Error(
            'ORDER_INSERT_FAILED'
        )
    }

    const order =
        orderRows[0]

    await manager.query(
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
            input.productId,
            input.quantity,
            Number(
                product.price_cents
            )
        ]
    )

    /*
     * Post-processing task is inserted
     * inside the SAME transaction.
     */
    await manager.query(
        `
        INSERT INTO job_queue (
            type,
            payload,
            status,
            processed
        )
        VALUES (
            'order-post-processing',
            $1::jsonb,
            'pending',
            0
        )
        `,
        [
            JSON.stringify({
                orderId:
                    order.id,

                userId:
                    input.userId
            })
        ]
    )

    return {
        orderId:
            String(order.id),

        remainingStock:
            Number(
                product.stock
            ),

        remainingBalanceCents:
            Number(
                balance.balance_cents
            )
    }
}