import 'reflect-metadata'

import {
    DataSource,
    Logger,
    QueryRunner
} from 'typeorm'

import { User } from './entities/user.entity.js'
import { Product } from './entities/product.entity.js'
import { Order } from './entities/order.entity.js'
import { OrderItem } from './entities/order-item.entity.js'

class CountingLogger implements Logger {
    public queryCount = 0

    logQuery(
        query: string,
        parameters?: unknown[],
        _queryRunner?: QueryRunner
    ): void {
        this.queryCount++

        console.log(`QUERY ${this.queryCount}:`)
        console.log(query)

        if (parameters?.length) {
            console.log(
                'PARAMETERS:',
                parameters
            )
        }
    }

    logQueryError(): void { }

    logQuerySlow(): void { }

    logSchemaBuild(): void { }

    logMigration(): void { }

    log(): void { }

    reset(): void {
        this.queryCount = 0
    }
}

function requiredEnv(
    name: string
): string {
    const value = process.env[name]

    if (!value) {
        throw new Error(
            `Missing required environment variable: ${name}`
        )
    }

    return value
}

const logger = new CountingLogger()

const dataSource = new DataSource({
    type: 'postgres',

    host: requiredEnv('DB_HOST'),

    port: Number(
        process.env.DB_PORT ?? '5432'
    ),

    username: requiredEnv(
        'DB_USER'
    ),

    password: requiredEnv(
        'DB_PASSWORD'
    ),

    database: requiredEnv(
        'DB_NAME'
    ),

    synchronize: false,

    logging: [
        'query'
    ],

    logger,

    entities: [
        User,
        Product,
        Order,
        OrderItem
    ]
})

async function runNaive(
    limit: number
): Promise<number> {
    logger.reset()

    console.log('')
    console.log(
        `=== N+1 NAIVE (${limit} orders) ===`
    )

    const orderRepository =
        dataSource.getRepository(Order)

    const orderItemRepository =
        dataSource.getRepository(OrderItem)

    const productRepository =
        dataSource.getRepository(Product)

    const orders =
        await orderRepository.find({
            take: limit,
            order: {
                id: 'ASC'
            }
        })

    for (const order of orders) {
        const items =
            await orderItemRepository.find({
                where: {
                    orderId: order.id
                }
            })

        for (const item of items) {
            await productRepository.findOne({
                where: {
                    id: item.productId
                }
            })
        }
    }

    console.log('')
    console.log(
        `Naive SQL queries: ${logger.queryCount}`
    )

    return logger.queryCount
}

async function runFixed(
    limit: number
): Promise<number> {
    logger.reset()

    console.log('')
    console.log(
        `=== FIXED (${limit} orders) ===`
    )

    const orderRepository =
        dataSource.getRepository(Order)

    await orderRepository
        .createQueryBuilder('orders')
        .leftJoinAndSelect(
            'orders.items',
            'items'
        )
        .leftJoinAndSelect(
            'items.product',
            'product'
        )
        .orderBy(
            'orders.id',
            'ASC'
        )
        .take(limit)
        .getMany()

    console.log('')
    console.log(
        `Fixed SQL queries: ${logger.queryCount}`
    )

    return logger.queryCount
}

async function main(): Promise<void> {
    await dataSource.initialize()

    try {
        const naiveSmall =
            await runNaive(2)

        const fixedSmall =
            await runFixed(2)

        const naiveLarge =
            await runNaive(5)

        const fixedLarge =
            await runFixed(5)

        console.log('')
        console.log(
            '=== SUMMARY ==='
        )

        console.log(
            `Naive 2 orders: ${naiveSmall}`
        )

        console.log(
            `Fixed 2 orders: ${fixedSmall}`
        )

        console.log(
            `Naive 5 orders: ${naiveLarge}`
        )

        console.log(
            `Fixed 5 orders: ${fixedLarge}`
        )

        console.log('')

        if (
            fixedSmall === fixedLarge
        ) {
            console.log(
                'Fixed query count is constant.'
            )
        } else {
            console.log(
                'Warning: fixed query count changed.'
            )
        }
    } finally {
        await dataSource.destroy()
    }
}

main().catch(error => {
    console.error(
        'N+1 demo failed'
    )

    console.error(error)

    process.exit(1)
})