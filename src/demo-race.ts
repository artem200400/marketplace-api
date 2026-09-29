import 'reflect-metadata'

import AppDataSource
    from './data-source.js'

import { User }
    from './entities/user.entity.js'

import { Product }
    from './entities/product.entity.js'

import {
    checkout
} from './checkout.js'

const ATTEMPTS = 50
const INITIAL_STOCK = 10

async function main(): Promise<void> {
    await AppDataSource.initialize()

    try {
        const userRepository =
            AppDataSource.getRepository(
                User
            )

        const productRepository =
            AppDataSource.getRepository(
                Product
            )

        const user =
            await userRepository.findOne({
                where: {
                    email:
                        'artem@example.com'
                }
            })

        if (!user) {
            throw new Error(
                'Race demo user not found. Run seed first.'
            )
        }

        const product =
            await productRepository.findOne({
                where: {
                    name:
                        'Gaming Mouse'
                }
            })

        if (!product) {
            throw new Error(
                'Race demo product not found. Run seed first.'
            )
        }

        await AppDataSource.transaction(
            async manager => {
                await manager.query(
                    `
                    DELETE FROM job_queue
                    `
                )

                await manager.query(
                    `
                    DELETE FROM order_items
                    WHERE order_id IN (
                        SELECT id
                        FROM orders
                        WHERE user_id = $1
                          AND created_at >
                              '2026-09-01'
                    )
                    `,
                    [
                        user.id
                    ]
                )

                await manager.query(
                    `
                    DELETE FROM orders
                    WHERE user_id = $1
                      AND created_at >
                          '2026-09-01'
                    `,
                    [
                        user.id
                    ]
                )

                await manager.query(
                    `
                    UPDATE products
                    SET stock = $1
                    WHERE id = $2
                    `,
                    [
                        INITIAL_STOCK,
                        product.id
                    ]
                )

                await manager.query(
                    `
                    UPDATE users
                    SET balance_cents =
                        10000000
                    WHERE id = $1
                    `,
                    [
                        user.id
                    ]
                )
            }
        )

        console.log('')
        console.log(
            '=== RACE DEMO ==='
        )

        console.log(
            `Initial stock: ${INITIAL_STOCK}`
        )

        console.log(
            `Attempts: ${ATTEMPTS}`
        )

        const attempts =
            Array.from(
                {
                    length:
                        ATTEMPTS
                },
                (_, index) =>
                    index + 1
            )

        const results =
            await Promise.all(
                attempts.map(
                    async attempt => {
                        try {
                            const result =
                                await AppDataSource
                                    .transaction(
                                        async manager =>
                                            checkout(
                                                manager,
                                                {
                                                    userId:
                                                        user.id,

                                                    productId:
                                                        product.id,

                                                    quantity:
                                                        1
                                                }
                                            )
                                    )

                            return {
                                attempt,
                                success: true,
                                orderId:
                                    result.orderId
                            }
                        } catch (
                            error
                        ) {
                            const message =
                                error instanceof Error
                                    ? error.message
                                    : String(error)

                            return {
                                attempt,
                                success: false,
                                error:
                                    message
                            }
                        }
                    }
                )
            )

        const successful =
            results.filter(
                result =>
                    result.success
            )

        const failed =
            results.filter(
                result =>
                    !result.success
            )

        const finalProduct =
            await productRepository.findOneByOrFail(
                {
                    id:
                        product.id
                }
            )

        const negativeStockRows =
            await AppDataSource.query(
                `
                SELECT COUNT(*)::int AS count
                FROM products
                WHERE stock < 0
                `
            ) as Array<{
                count: number
            }>

        const negativeCount =
            Number(
                negativeStockRows[0]
                    ?.count ?? 0
            )

        console.log('')
        console.log(
            `Successful: ${successful.length}`
        )

        console.log(
            `Failed: ${failed.length}`
        )

        console.log(
            `Final stock: ${finalProduct.stock}`
        )

        console.log(
            `Negative stock rows: ${negativeCount}`
        )

        console.log('')

        const invariantOk =
            ATTEMPTS >= 50 &&
            successful.length ===
                INITIAL_STOCK &&
            finalProduct.stock === 0 &&
            negativeCount === 0

        if (!invariantOk) {
            console.error(
                'RACE INVARIANT FAILED'
            )

            process.exitCode = 1
            return
        }

        console.log(
            'Race invariant OK'
        )
    } finally {
        await AppDataSource.destroy()
    }
}

main().catch(error => {
    console.error(
        'Race demo failed'
    )

    console.error(error)

    process.exit(1)
})