import {
    Module
} from '@nestjs/common'

import {
    ConfigModule
} from '@nestjs/config'

import {
    validateEnv
} from './config/env.schema.js'

import {
    DatabaseModule
} from './database/database.module.js'

import {
    HealthController
} from './health.controller.js'

import {
    OrdersController
} from './orders.controller.js'

import {
    OrderEventsService
} from './order-events.service.js'

import {
    OrdersService
} from './orders.service.js'

import {
    OrdersGateway
} from './orders.gateway.js'

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
            validate: validateEnv
        }),

        DatabaseModule
    ],

    controllers: [
        HealthController,
        OrdersController
    ],

    providers: [
        OrderEventsService,
        OrdersService,
        OrdersGateway
    ]
})
export class AppModule { }