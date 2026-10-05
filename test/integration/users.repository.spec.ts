import {
    beginTestTransaction,
    rollbackTestTransaction,
    startPostgres,
    stopPostgres
} from './testkit/postgres.js'

import {
    aUser
} from './testkit/builders.js'

import {
    UserRepository
} from '../../src/repositories/user.repository.js'

import type {
    PoolClient
} from 'pg'

describe(
    'UserRepository integration',
    () => {
        let client:
            PoolClient | undefined

        let repository:
            UserRepository

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
                new UserRepository(
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
            'creates and reads a user',
            async () => {
                const input =
                    aUser()

                await repository.create(
                    input
                )

                const found =
                    await repository
                        .findByEmail(
                            input.email
                        )

                expect(
                    found
                ).not.toBeNull()

                expect(
                    found?.email
                ).toBe(
                    input.email
                )
            }
        )

        it(
            'enforces UNIQUE email constraint',
            async () => {
                const input =
                    aUser({
                        email:
                            'duplicate@example.com'
                    })

                await repository.create(
                    input
                )

                await expect(
                    repository.create(
                        input
                    )
                ).rejects.toMatchObject({
                    code: '23505'
                })
            }
        )

        it(
            'uses ON CONFLICT for upsert',
            async () => {
                const input =
                    aUser({
                        email:
                            'upsert@example.com',
                        name:
                            'First name'
                    })

                await repository.upsert(
                    input
                )

                const updated =
                    await repository.upsert({
                        ...input,
                        name:
                            'Updated name',
                        balanceCents:
                            555
                    })

                expect(
                    updated.name
                ).toBe(
                    'Updated name'
                )

                expect(
                    updated.balance_cents
                ).toBe(
                    555
                )
            }
        )
    }
)