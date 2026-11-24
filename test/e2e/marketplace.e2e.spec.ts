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

                // The E2E suite defines its own isolated schema.
                await pool.query(`
                  ALTER TABLE users ADD COLUMN password_hash text;
                  ALTER TABLE users ADD COLUMN role varchar(20) NOT NULL DEFAULT 'USER';
                  CREATE TABLE auth_sessions (
                    id uuid PRIMARY KEY, family_id uuid NOT NULL, user_id bigint NOT NULL REFERENCES users(id),
                    refresh_hash char(64) NOT NULL UNIQUE, expires_at timestamptz NOT NULL,
                    revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
                  );
                  CREATE TABLE order_idempotency (
                    user_id bigint NOT NULL REFERENCES users(id),
                    idempotency_key varchar(200) NOT NULL,
                    order_id bigint REFERENCES orders(id) ON DELETE CASCADE,
                    created_at timestamptz NOT NULL DEFAULT now(),
                    PRIMARY KEY(user_id,idempotency_key)
                  );
                  CREATE TABLE outbox (
                    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                    aggregate_type varchar(80) NOT NULL,
                    aggregate_id varchar(80) NOT NULL,
                    type varchar(120) NOT NULL,
                    payload jsonb NOT NULL,
                    created_at timestamptz NOT NULL DEFAULT now(),
                    published_at timestamptz,
                    attempts integer NOT NULL DEFAULT 0
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

                process.env.AUTH_JWT_SECRET = 'coursework-e2e-only-' + 'a'.repeat(48)
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

                delete process.env.AUTH_JWT_SECRET
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

        let bearer: string
        it('registers and logs in',async()=>{
            const email='authenticated-e2e@example.invalid'
            const password='ExamplePasswordForE2ETests123!'
            await request(app.getHttpServer()).post('/auth/register').send({email,password}).expect(201)
            const result=await request(app.getHttpServer()).post('/auth/login').send({email,password}).expect(200)
            bearer='Bearer '+result.body.access_token
            expect(bearer).toContain('Bearer ')
        })

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
                        .set('Authorization',bearer)
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
                        .set('Authorization',bearer)
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

        it('rejects anonymous order access',async()=>{
            await request(app.getHttpServer()).get('/orders/1').expect(401)
        })

        it(
            'returns 404 for a missing order',
            async () => {
                await request(
                    app.getHttpServer()
                )
                    .get(
                        '/orders/999999'
                    )
                    .set('Authorization',bearer)
                    .expect(
                        404
                    )
            }
        )
    }
)