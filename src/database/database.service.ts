import {
    Injectable,
    OnModuleDestroy
} from '@nestjs/common'

import {
    ConfigService
} from '@nestjs/config'

import {
    readFile
} from 'node:fs/promises'

import {
    Pool,
    type PoolClient,
    QueryResultRow
} from 'pg'

import type {
    Env
} from '../config/env.schema.js'

@Injectable()
export class DatabaseService
implements OnModuleDestroy {
    private readonly pool: Pool

    constructor(
        private readonly config:
            ConfigService<Env, true>
    ) {
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
            this.config.get(
                'DB_PASSWORD_FILE',
                {
                    infer: true
                }
            )

        this.pool = new Pool({
            host:
                this.config.get(
                    'DB_HOST',
                    {
                        infer: true
                    }
                ),

            port:
                this.config.get(
                    'DB_PORT',
                    {
                        infer: true
                    }
                ),

            database:
                this.config.get(
                    'DB_NAME',
                    {
                        infer: true
                    }
                ),

            user:
                this.config.get(
                    'DB_USER',
                    {
                        infer: true
                    }
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
