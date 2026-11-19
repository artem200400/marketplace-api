import {
    Injectable,
    OnModuleDestroy
} from '@nestjs/common'

import {
    readFile
} from 'node:fs/promises'

import {
    Pool,
    type PoolClient,
    QueryResultRow
} from 'pg'

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

@Injectable()
export class DatabaseService
implements OnModuleDestroy {
    private readonly pool: Pool

    constructor() {
        const databaseUrl =
            process.env.DATABASE_URL ??
            process.env.DB_URL

        if (databaseUrl) {
            this.pool =
                new Pool({
                    connectionString:
                        databaseUrl
                })

            this.attachPoolErrorHandler()
            return
        }

        const passwordFile =
            process.env
                .DB_PASSWORD_FILE ??
            'secrets/db_password'

        this.pool = new Pool({
            host:
                requiredEnv(
                    'DB_HOST'
                ),

            port:
                Number(
                    process.env.DB_PORT ??
                    '5432'
                ),

            database:
                requiredEnv(
                    'DB_NAME'
                ),

            user:
                requiredEnv(
                    'DB_USER'
                ),

            password:
                async () => {
                    const password =
                        await readFile(
                            passwordFile,
                            'utf8'
                        )

                    return password.trim()
                }
        })

        this.attachPoolErrorHandler()
    }

    private attachPoolErrorHandler() {
        this.pool.on(
            'error',
            error => {
                console.error(
                    'Unexpected PostgreSQL pool error:',
                    error.message
                )
            }
        )
    }

    async query<
        T extends QueryResultRow =
            QueryResultRow
    >(
        text: string,
        params?: unknown[]
    ) {
        return this.pool.query<T>(
            text,
            params
        )
    }

    async transaction<T>(
        fn: (
            client: PoolClient
        ) => Promise<T>
    ): Promise<T> {
        const client =
            await this.pool.connect()

        try {
            await client.query(
                'BEGIN'
            )

            const result =
                await fn(client)

            await client.query(
                'COMMIT'
            )

            return result
        }
        catch (error) {
            await client.query(
                'ROLLBACK'
            )

            throw error
        }
        finally {
            client.release()
        }
    }

    async onModuleDestroy() {
        await this.pool.end()
    }
}
