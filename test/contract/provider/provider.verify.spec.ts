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
    Verifier
} from '@pact-foundation/pact'

import {
    Pool
} from 'pg'

import {
    mkdtemp,
    rm,
    writeFile
} from 'node:fs/promises'

import {
    tmpdir
} from 'node:os'

import {
    join,
    resolve
} from 'node:path'


describe(
    'MarketplaceAPI Pact provider',
    () => {
        let container:
            StartedPostgreSqlContainer

        let pool:
            Pool

        let app:
            INestApplication

        let tempDirectory:
            string

        let providerBaseUrl:
            string

        beforeAll(
            async () => {
                container =
                    await new PostgreSqlContainer(
                        'postgres:16-alpine'
                    )
                        .withDatabase(
                            'marketplace_contract'
                        )
                        .withUsername(
                            'contract_user'
                        )
                        .withPassword(
                            'contract_password'
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
                            DEFAULT NOW()
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
                            DEFAULT NOW()
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

                tempDirectory =
                    await mkdtemp(
                        join(
                            tmpdir(),
                            'marketplace-pact-'
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
                    '3002'

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
                    '../../../src/app.module.js'
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

                await app.listen(
                    0,
                    '127.0.0.1'
                )

                const address =
                    app
                        .getHttpServer()
                        .address()

                if (
                    !address ||
                    typeof address ===
                    'string'
                ) {
                    throw new Error(
                        'Unable to determine provider port'
                    )
                }

                providerBaseUrl =
                    `http://127.0.0.1:${address.port}`
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
            'verifies the MarketplaceFrontend pact',
            async () => {
                const brokerUrl =
                    process.env
                        .PACT_BROKER_URL

                const brokerToken =
                    process.env
                        .PACT_BROKER_TOKEN

                const providerVersion =
                    process.env
                        .PACT_PROVIDER_VERSION ??
                    process.env
                        .GITHUB_SHA ??
                    'local-provider'

                const verifier =
                    new Verifier({
                        provider:
                            'MarketplaceAPI',

                        providerBaseUrl,

                        stateHandlers: {
                            'order 1 exists':
                                async () => {
                                    await pool.query(`
                                        TRUNCATE TABLE
                                            order_items,
                                            orders,
                                            products,
                                            users
                                        RESTART IDENTITY
                                        CASCADE;
                                    `)

                                    await pool.query(
                                        `
                                        INSERT INTO users (
                                            id,
                                            name,
                                            email,
                                            balance_cents
                                        )
                                        VALUES (
                                            1,
                                            $1,
                                            $2,
                                            $3
                                        )
                                        `,
                                        [
                                            'Pact User',
                                            'pact@example.com',
                                            100000
                                        ]
                                    )

                                    await pool.query(
                                        `
                                        INSERT INTO products (
                                            id,
                                            name,
                                            description,
                                            price_cents,
                                            stock
                                        )
                                        VALUES (
                                            1,
                                            $1,
                                            $2,
                                            $3,
                                            $4
                                        )
                                        `,
                                        [
                                            'Pact Keyboard',
                                            'Contract test product',
                                            12999,
                                            10
                                        ]
                                    )

                                    await pool.query(
                                        `
                                        INSERT INTO orders (
                                            id,
                                            user_id,
                                            status,
                                            total_amount_cents,
                                            created_at
                                        )
                                        VALUES (
                                            1,
                                            1,
                                            'pending',
                                            25998,
                                            '2026-10-05T12:00:00.000Z'
                                        )
                                        `
                                    )

                                    await pool.query(
                                        `
                                        INSERT INTO order_items (
                                            id,
                                            order_id,
                                            product_id,
                                            quantity,
                                            unit_price_cents
                                        )
                                        VALUES (
                                            1,
                                            1,
                                            1,
                                            2,
                                            12999
                                        )
                                        `
                                    )
                                }
                        },

                        publishVerificationResult:
                            Boolean(
                                brokerUrl
                            ),

                        providerVersion,

                        ...(brokerUrl
                            ? {
                                pactBrokerUrl:
                                    brokerUrl,

                                consumerVersionSelectors: [
                                    {
                                        latest:
                                            true
                                    }
                                ],

                                ...(brokerToken
                                    ? {
                                        pactBrokerToken:
                                            brokerToken
                                    }
                                    : {})
                            }
                            : {
                                pactUrls: [
                                    resolve(
                                        process.cwd(),
                                        'pacts',
                                        'MarketplaceFrontend-MarketplaceAPI.json'
                                    )
                                ]
                            })
                    })

                await verifier
                    .verifyProvider()
            },
            60000
        )
    }
)