import 'reflect-metadata'

import { DataSource } from 'typeorm'

import { User } from './entities/user.entity.js'
import { Product } from './entities/product.entity.js'
import { Order } from './entities/order.entity.js'
import { OrderItem } from './entities/order-item.entity.js'
import { JobQueue } from './entities/job-queue.entity.js'

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

const port = Number(
    process.env.DB_PORT ?? '5432'
)

const AppDataSource = new DataSource({
    type: 'postgres',

    host: requiredEnv(
        'DB_HOST'
    ),

    port,

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

    logging: false,

    entities: [
        User,
        Product,
        Order,
        OrderItem,
        JobQueue
    ],

    migrations: [
        'dist/migrations/*.js'
    ]
})

export default AppDataSource