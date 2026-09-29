import 'reflect-metadata'

import AppDataSource
    from './data-source.js'

const INITIAL_BALANCE = 1_000_000
const CHANGE_PER_TRANSACTION = 1_000
const MAX_RETRIES = 5

let firstReaders = 0

let releaseFirstBarrier:
    (() => void) | null = null

const firstBarrier =
    new Promise<void>(
        resolve => {
            releaseFirstBarrier =
                resolve
        }
    )

function sleep(
    ms: number
): Promise<void> {
    return new Promise(
        resolve =>
            setTimeout(resolve, ms)
    )
}

function getErrorCode(
    error: unknown
): string | undefined {
    if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error
    ) {
        const code =
            (
                error as {
                    code?: unknown
                }
            ).code

        if (
            typeof code === 'string'
        ) {
            return code
        }
    }

    if (
        typeof error === 'object' &&
        error !== null &&
        'driverError' in error
    ) {
        const driverError =
            (
                error as {
                    driverError?: {
                        code?: unknown
                    }
                }
            ).driverError

        if (
            typeof driverError?.code ===
            'string'
        ) {
            return driverError.code
        }
    }

    return undefined
}

async function withRetry<T>(
    name: string,
    operation:
        (attempt: number) =>
            Promise<T>
): Promise<{
    result: T
    retries: number
}> {
    let retries = 0

    for (
        let attempt = 1;
        attempt <= MAX_RETRIES + 1;
        attempt++
    ) {
        try {
            const result =
                await operation(attempt)

            return {
                result,
                retries
            }
        } catch (error) {
            const code =
                getErrorCode(error)

            if (
                code !== '40001' &&
                code !== '40P01'
            ) {
                throw error
            }

            if (
                attempt > MAX_RETRIES
            ) {
                throw error
            }

            retries++

            const backoffMs =
                50 * attempt

            console.log(
                `${name}: caught ${code}, retry ${retries}, backoff ${backoffMs} ms`
            )

            await sleep(backoffMs)
        }
    }

    throw new Error(
        'Retry loop exhausted'
    )
}

async function changeBalance(
    name: string,
    userId: string,
    attempt: number
): Promise<number> {
    const queryRunner =
        AppDataSource
            .createQueryRunner()

    await queryRunner.connect()

    try {
        await queryRunner
            .startTransaction(
                'REPEATABLE READ'
            )

        const selectResult =
            await queryRunner.query(
                `
                SELECT balance_cents
                FROM users
                WHERE id = $1
                `,
                [
                    userId
                ]
            )

        const rows =
            Array.isArray(selectResult) &&
            Array.isArray(selectResult[0])
                ? selectResult[0]
                : selectResult

        if (
            !Array.isArray(rows) ||
            rows.length === 0
        ) {
            throw new Error(
                'USER_NOT_FOUND'
            )
        }

        const currentBalance =
            Number(
                rows[0].balance_cents
            )

        console.log(
            `${name}: attempt ${attempt}, read balance ${currentBalance}`
        )

        if (attempt === 1) {
            firstReaders++

            if (
                firstReaders === 2
            ) {
                releaseFirstBarrier?.()
            }

            await firstBarrier
        }

        const newBalance =
            currentBalance -
            CHANGE_PER_TRANSACTION

        await queryRunner.query(
            `
            UPDATE users
            SET balance_cents = $1
            WHERE id = $2
            `,
            [
                newBalance,
                userId
            ]
        )

        await queryRunner
            .commitTransaction()

        console.log(
            `${name}: committed balance ${newBalance}`
        )

        return newBalance
    } catch (error) {
        if (
            queryRunner
                .isTransactionActive
        ) {
            await queryRunner
                .rollbackTransaction()
        }

        throw error
    } finally {
        await queryRunner.release()
    }
}

async function main():
Promise<void> {
    await AppDataSource.initialize()

    try {
        const userResult =
            await AppDataSource.query(
                `
                SELECT id
                FROM users
                WHERE email =
                    'artem@example.com'
                LIMIT 1
                `
            )

        const rows =
            Array.isArray(userResult) &&
            Array.isArray(userResult[0])
                ? userResult[0]
                : userResult

        if (
            !Array.isArray(rows) ||
            rows.length === 0
        ) {
            throw new Error(
                'Demo user not found. Run seed first.'
            )
        }

        const userId =
            String(rows[0].id)

        await AppDataSource.query(
            `
            UPDATE users
            SET balance_cents = $1
            WHERE id = $2
            `,
            [
                INITIAL_BALANCE,
                userId
            ]
        )

        console.log('')
        console.log(
            '=== RETRY DEMO ==='
        )

        console.log(
            `Initial balance: ${INITIAL_BALANCE}`
        )

        console.log(
            `Each transaction subtracts: ${CHANGE_PER_TRANSACTION}`
        )

        const [
            first,
            second
        ] = await Promise.all([
            withRetry(
                'transaction-A',
                attempt =>
                    changeBalance(
                        'transaction-A',
                        userId,
                        attempt
                    )
            ),

            withRetry(
                'transaction-B',
                attempt =>
                    changeBalance(
                        'transaction-B',
                        userId,
                        attempt
                    )
            )
        ])

        const finalResult =
            await AppDataSource.query(
                `
                SELECT balance_cents
                FROM users
                WHERE id = $1
                `,
                [
                    userId
                ]
            )

        const finalRows =
            Array.isArray(finalResult) &&
            Array.isArray(finalResult[0])
                ? finalResult[0]
                : finalResult

        const finalBalance =
            Number(
                finalRows[0]
                    .balance_cents
            )

        const totalRetries =
            first.retries +
            second.retries

        const expectedBalance =
            INITIAL_BALANCE -
            (
                CHANGE_PER_TRANSACTION *
                2
            )

        console.log('')
        console.log(
            `Transaction A retries: ${first.retries}`
        )

        console.log(
            `Transaction B retries: ${second.retries}`
        )

        console.log(
            `Total retries: ${totalRetries}`
        )

        console.log(
            `Expected balance: ${expectedBalance}`
        )

        console.log(
            `Final balance: ${finalBalance}`
        )

        console.log('')

        if (
            totalRetries < 1 ||
            finalBalance !==
                expectedBalance
        ) {
            console.error(
                'RETRY INVARIANT FAILED'
            )

            process.exitCode = 1
            return
        }

        console.log(
            'Retry invariant OK'
        )
    } finally {
        await AppDataSource.destroy()
    }
}

main().catch(error => {
    console.error(
        'Retry demo failed'
    )

    console.error(error)

    process.exit(1)
})