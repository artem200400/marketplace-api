import {
    Test
} from '@nestjs/testing'

import type {
    INestApplication
} from '@nestjs/common'

import {
    PostgreSqlContainer,
    StartedPostgreSqlContainer
} from '@testcontainers/postgresql'

import {
    Pool
} from 'pg'

import request
    from 'supertest'

import {
    mkdtemp,
    rm,
    writeFile
} from 'node:fs/promises'

import {
    tmpdir
} from 'node:os'

import {
    join
} from 'node:path'


describe(
    'Marketplace E2E',
    () => {
        let container:
            StartedPostgreSqlContainer

        let pool:
            Pool

        let app:
            INestApplication

        let tempDirectory:
            string

        let productId:
            string

        beforeAll(
            async () => {
                container =
                    await new PostgreSqlContainer(
                        'postgres:16-alpine'
                    )
                        .withDatabase(
                            'marketplace_e2e'
                        )
                        .withUsername(
                            'e2e_user'
                        )
                        .withPassword(
                            'e2e_password'
                        )
                        .start()

                pool =
                    new Pool({
                        connectionString:
                            container
                                .getConnectionUri()
                    })

                await pool.query(`
                    CREATE TABLE users (
                        id BIGSERIAL
                            PRIMARY KEY,

                        name VARCHAR(120)
                            NOT NULL,

                        email VARCHAR(255)
                            NOT NULL
                            UNIQUE,

                        balance_cents INTEGER
                            NOT NULL
                            DEFAULT 0,

                        created_at TIMESTAMPTZ
                            NOT NULL
                            DEFAULT NOW(),

                        CONSTRAINT
                            chk_users_balance
                            CHECK (
                                balance_cents >= 0
                            )
                    );

                    CREATE TABLE products (
                        id BIGSERIAL
                            PRIMARY KEY,

                        name VARCHAR(255)
                            NOT NULL,

                        description TEXT
                            NOT NULL,

                        price_cents INTEGER
                            NOT NULL,

                        stock INTEGER
                            NOT NULL,

                        created_at TIMESTAMPTZ
                            NOT NULL
                            DEFAULT NOW(),

                        CONSTRAINT
                            chk_products_price
                            CHECK (
                                price_cents >= 0
                            ),

                        CONSTRAINT
                            chk_products_stock
                            CHECK (
                                stock >= 0
                            )
                    );

                    CREATE TABLE orders (
                        id BIGSERIAL
                            PRIMARY KEY,

                        user_id BIGINT
                            NOT NULL
                            REFERENCES users(id)
                            ON DELETE RESTRICT,

                        status VARCHAR(20)
                            NOT NULL,

                        total_amount_cents INTEGER
                            NOT NULL,

                        created_at TIMESTAMPTZ
                            NOT NULL
                            DEFAULT NOW()
                    );

                    CREATE TABLE order_items (
                        id BIGSERIAL
                            PRIMARY KEY,

                        order_id BIGINT
                            NOT NULL
                            REFERENCES orders(id)
                            ON DELETE CASCADE,

                        product_id BIGINT
                            NOT NULL
                            REFERENCES products(id)
                            ON DELETE RESTRICT,

                        quantity INTEGER
                            NOT NULL,

                        unit_price_cents INTEGER
                            NOT NULL
                    );
                `)

                await pool.query(
                    `
                    INSERT INTO users (
                        name,
                        email,
                        balance_cents
                    )
                    VALUES (
                        $1,
                        $2,
                        $3
                    )
                    `,
                    [
                        'E2E User',
                        'e2e@example.com',
                        100000
                    ]
                )

                const productResult =
                    await pool.query<{
                        id: string
                    }>(
                        `
                        INSERT INTO products (
                            name,
                            description,
                            price_cents,
                            stock
                        )
                        VALUES (
                            $1,
                            $2,
                            $3,
                            $4
                        )
                        RETURNING id::text
                        `,
                        [
                            'E2E Keyboard',
                            'Keyboard used by E2E test',
                            12999,
                            10
                        ]
                    )

                productId =
                    productResult
                        .rows[0]
                        .id

                tempDirectory =
                    await mkdtemp(
                        join(
                            tmpdir(),
                            'marketplace-e2e-'
                        )
                    )

                const passwordFile =
                    join(
                        tempDirectory,
                        'db_password'
                    )

                await writeFile(
                    passwordFile,
                    container.getPassword(),
                    'utf8'
                )

                process.env.PORT =
                    '3001'

                process.env.DB_HOST =
                    container.getHost()

                process.env.DB_PORT =
                    String(
                        container.getPort()
                    )

                process.env.DB_NAME =
                    container.getDatabase()

                process.env.DB_USER =
                    container.getUsername()

                process.env.DB_PASSWORD_FILE =
                    passwordFile

                process.env.DB_URL =
                    container
                        .getConnectionUri()

                process.env.DATABASE_URL =
                    container
                        .getConnectionUri()

                const {
                    AppModule
                } = await import(
                    '../../src/app.module.js'
                )

                const moduleRef =
                    await Test
                        .createTestingModule({
                            imports: [
                                AppModule
                            ]
                        })
                        .compile()

                app =
                    moduleRef
                        .createNestApplication()

                await app.init()
            },
            60000
        )

        afterAll(
            async () => {
                if (app) {
                    await app.close()
                }

                if (pool) {
                    await pool.end()
                }

                if (container) {
                    await container.stop()
                }

                if (tempDirectory) {
                    await rm(
                        tempDirectory,
                        {
                            recursive: true,
                            force: true
                        }
                    )
                }

                delete process.env.PORT
                delete process.env.DB_HOST
                delete process.env.DB_PORT
                delete process.env.DB_NAME
                delete process.env.DB_USER
                delete process.env.DB_PASSWORD_FILE
                delete process.env.DB_URL
                delete process.env.DATABASE_URL
            },
            60000
        )

        it(
            'creates an order and reads it back',
            async () => {
                const createResponse =
                    await request(
                        app.getHttpServer()
                    )
                        .post(
                            '/orders'
                        )
                        .set(
                            'Idempotency-Key',
                            'e2e-order-1'
                        )
                        .send({
                            items: [
                                {
                                    product_id:
                                        productId,

                                    quantity:
                                        2
                                }
                            ]
                        })
                        .expect(
                            201
                        )

                expect(
                    createResponse.body.id
                ).toBeDefined()

                expect(
                    createResponse
                        .body
                        .total_cents
                ).toBe(
                    25998
                )

                expect(
                    createResponse
                        .body
                        .items
                ).toHaveLength(
                    1
                )

                expect(
                    createResponse
                        .body
                        .items[0]
                        .product_id
                ).toBe(
                    productId
                )

                expect(
                    createResponse
                        .body
                        .items[0]
                        .quantity
                ).toBe(
                    2
                )

                expect(
                    createResponse
                        .body
                        .items[0]
                        .unit_price_cents
                ).toBe(
                    12999
                )

                const orderId =
                    createResponse
                        .body
                        .id

                const readResponse =
                    await request(
                        app.getHttpServer()
                    )
                        .get(
                            `/orders/${orderId}`
                        )
                        .expect(
                            200
                        )

                expect(
                    readResponse.body.id
                ).toBe(
                    orderId
                )

                expect(
                    readResponse
                        .body
                        .total_cents
                ).toBe(
                    25998
                )

                expect(
                    readResponse
                        .body
                        .items
                ).toHaveLength(
                    1
                )

                expect(
                    readResponse
                        .body
                        .items[0]
                        .product_id
                ).toBe(
                    productId
                )

                expect(
                    readResponse
                        .body
                        .items[0]
                        .quantity
                ).toBe(
                    2
                )

                expect(
                    readResponse
                        .body
                        .items[0]
                        .unit_price_cents
                ).toBe(
                    12999
                )
            }
        )

        it(
            'returns 404 for a missing order',
            async () => {
                await request(
                    app.getHttpServer()
                )
                    .get(
                        '/orders/999999'
                    )
                    .expect(
                        404
                    )
            }
        )
    }
)