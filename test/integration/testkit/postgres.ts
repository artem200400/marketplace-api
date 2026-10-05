import {
    PostgreSqlContainer,
    StartedPostgreSqlContainer
} from '@testcontainers/postgresql'

import {
    Pool,
    PoolClient
} from 'pg'

let container:
    StartedPostgreSqlContainer | undefined

let pool:
    Pool | undefined

export async function startPostgres() {
    container =
        await new PostgreSqlContainer(
            'postgres:16-alpine'
        )
            .withDatabase(
                'marketplace_test'
            )
            .withUsername(
                'test_user'
            )
            .withPassword(
                'test_password'
            )
            .start()

    pool =
        new Pool({
            connectionString:
                container.getConnectionUri()
        })

    await createSchema()

    return {
        container,
        pool
    }
}

async function createSchema() {
    if (!pool) {
        throw new Error(
            'PostgreSQL pool is not started'
        )
    }

    await pool.query(`
        CREATE TABLE users (
            id BIGSERIAL PRIMARY KEY,

            name VARCHAR(120)
                NOT NULL,

            email VARCHAR(255)
                NOT NULL
                UNIQUE,

            balance_cents INTEGER
                NOT NULL
                DEFAULT 0,

            CONSTRAINT chk_users_balance
                CHECK (
                    balance_cents >= 0
                )
        );

        CREATE TABLE products (
            id BIGSERIAL PRIMARY KEY,

            name VARCHAR(255)
                NOT NULL,

            description TEXT
                NOT NULL,

            price_cents INTEGER
                NOT NULL,

            stock INTEGER
                NOT NULL,

            CONSTRAINT chk_products_price
                CHECK (
                    price_cents >= 0
                ),

            CONSTRAINT chk_products_stock
                CHECK (
                    stock >= 0
                )
        );

        CREATE TABLE orders (
            id BIGSERIAL PRIMARY KEY,

            user_id BIGINT
                NOT NULL
                REFERENCES users(id)
                ON DELETE RESTRICT,

            status VARCHAR(20)
                NOT NULL,

            total_amount_cents INTEGER
                NOT NULL
        );

        CREATE TABLE order_items (
            id BIGSERIAL PRIMARY KEY,

            order_id BIGINT
                NOT NULL
                REFERENCES orders(id)
                ON DELETE CASCADE,

            product_id BIGINT
                NOT NULL
                REFERENCES products(id)
                ON DELETE RESTRICT,

            quantity INTEGER
                NOT NULL
        );
    `)
}

export async function beginTestTransaction():
    Promise<PoolClient> {
    if (!pool) {
        throw new Error(
            'PostgreSQL pool is not started'
        )
    }

    const client =
        await pool.connect()

    await client.query(
        'BEGIN'
    )

    return client
}

export async function rollbackTestTransaction(
    client:
        PoolClient | undefined
) {
    if (!client) {
        return
    }

    try {
        await client.query(
            'ROLLBACK'
        )
    } finally {
        client.release()
    }
}

export async function stopPostgres() {
    if (pool) {
        await pool.end()
        pool = undefined
    }

    if (container) {
        await container.stop()
        container = undefined
    }
}