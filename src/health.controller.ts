import {
    Controller,
    Get
} from '@nestjs/common'

import { DatabaseService } from './database/database.service.js'

const startedAt =
    Date.now()

@Controller()
export class HealthController {
    constructor(
        private readonly database:
            DatabaseService
    ) { }

    @Get('health')
    health() {
        return {
            status: 'ok',
            uptime:
                Math.floor(
                    (
                        Date.now() -
                        startedAt
                    ) / 1000
                )
        }
    }

    @Get('db-check')
    async dbCheck() {
        const result =
            await this.database.query<{
                now: string
            }>(
                'SELECT NOW() AS now'
            )

        return {
            status: 'ok',
            database: result.rows[0]
        }
    }
}