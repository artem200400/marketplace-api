import {
    Injectable,
    OnModuleDestroy
} from '@nestjs/common'

import { ConfigService } from '@nestjs/config'
import { readFile } from 'node:fs/promises'

import {
    Pool,
    QueryResultRow
} from 'pg'

import type { Env } from '../config/env.schema.js'


@Injectable()
export class DatabaseService implements OnModuleDestroy {
    private readonly pool: Pool

    constructor(
        private readonly config: ConfigService<Env, true>
    ) {
        const passwordFile =
            this.config.get(
                'DB_PASSWORD_FILE',
                {
                    infer: true
                }
            )

        this.pool = new Pool({
            host: this.config.get(
                'DB_HOST',
                {
                    infer: true
                }
            ),

            port: this.config.get(
                'DB_PORT',
                {
                    infer: true
                }
            ),

            database: this.config.get(
                'DB_NAME',
                {
                    infer: true
                }
            ),

            user: this.config.get(
                'DB_USER',
                {
                    infer: true
                }
            ),

            password: async () => {
                const password =
                    await readFile(
                        passwordFile,
                        'utf8'
                    )

                return password.trim()
            }
        })

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
        T extends QueryResultRow = QueryResultRow
    >(
        text: string,
        params?: unknown[]
    ) {
        return this.pool.query<T>(
            text,
            params
        )
    }

    async onModuleDestroy() {
        await this.pool.end()
    }
}