import 'reflect-metadata'

import { DataSource } from 'typeorm'

import { User }
    from './entities/user.entity.js'

import { Product }
    from './entities/product.entity.js'

import { Order }
    from './entities/order.entity.js'

import { OrderItem }
    from './entities/order-item.entity.js'

import { JobQueue }
    from './entities/job-queue.entity.js'

function requiredEnv(
    name: string
): string {
    const value =
        process.env[name]

    if (!value) {
        throw new Error(
            `Missing required environment variable: ${name}`
        )
    }

    return value
}

/*
 * Since HW15 the primary connection contract
 * is DATABASE_URL.
 *
 * In dev/prod this URL points to PgBouncer.
 *
 * DB_* variables are kept as a fallback so
 * earlier homework commands still work.
 */
const databaseUrl =
    process.env.DATABASE_URL ??
    process.env.DB_URL

const connection =
    databaseUrl
        ? {
            url:
                databaseUrl
        }
        : {
            host:
                requiredEnv(
                    'DB_HOST'
                ),

            port:
                Number(
                    process.env.DB_PORT ??
                    '5432'
                ),

            username:
                requiredEnv(
                    'DB_USER'
                ),

            password:
                requiredEnv(
                    'DB_PASSWORD'
                ),

            database:
                requiredEnv(
                    'DB_NAME'
                )
        }

const AppDataSource =
    new DataSource({
        type: 'postgres',

        ...connection,

        synchronize:
            false,

        logging:
            false,

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