import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'

import { validateEnv } from './config/env.schema.js'
import { DatabaseModule } from './database/database.module.js'
import { HealthController } from './health.controller.js'

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
            validate: validateEnv
        }),

        DatabaseModule
    ],

    controllers: [
        HealthController
    ]
})
export class AppModule { }