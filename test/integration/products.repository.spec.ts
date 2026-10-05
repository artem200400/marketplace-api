import {
    beginTestTransaction,
    rollbackTestTransaction,
    startPostgres,
    stopPostgres
} from './testkit/postgres.js'

import {
    aProduct
} from './testkit/builders.js'

import {
    ProductRepository
} from '../../src/repositories/product.repository.js'

import type {
    PoolClient
} from 'pg'

describe(
    'ProductRepository integration',
    () => {
        let client:
            PoolClient | undefined

        let repository:
            ProductRepository

        beforeAll(
            async () => {
                await startPostgres()
            },
            60000
        )

        afterAll(
            async () => {
                await stopPostgres()
            },
            60000
        )

        beforeEach(async () => {
            const startedClient =
                await beginTestTransaction()

            client =
                startedClient

            repository =
                new ProductRepository(
                    startedClient
                )
        })

        afterEach(async () => {
            await rollbackTestTransaction(
                client
            )

            client =
                undefined
        })

        it(
            'creates a product',
            async () => {
                const product =
                    await repository.create(
                        aProduct()
                    )

                expect(
                    product.id
                ).toBeDefined()

                expect(
                    product.stock
                ).toBe(
                    5
                )
            }
        )

        it(
            'reads product by id',
            async () => {
                const created =
                    await repository.create(
                        aProduct({
                            name:
                                'Keyboard'
                        })
                    )

                const found =
                    await repository
                        .findById(
                            created.id
                        )

                expect(
                    found?.name
                ).toBe(
                    'Keyboard'
                )
            }
        )

        it(
            'calculates inventory value using SQL SUM',
            async () => {
                await repository.create(
                    aProduct({
                        priceCents:
                            1000,
                        stock:
                            2
                    })
                )

                await repository.create(
                    aProduct({
                        priceCents:
                            500,
                        stock:
                            4
                    })
                )

                const total =
                    await repository
                        .totalInventoryValue()

                expect(
                    total
                ).toBe(
                    4000
                )
            }
        )
    }
)