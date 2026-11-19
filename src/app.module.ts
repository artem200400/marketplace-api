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

import {
    RabbitPublisher
} from './messaging/rabbit.publisher.js'

import {
    RabbitConsumer
} from './messaging/rabbit.consumer.js'

import {
    AuthController
} from './auth/auth.controller.js'

import {
    AuthService
} from './auth/auth.service.js'

import {
    AuthGuard
} from './auth/auth.guard.js'

import {
    RolesGuard
} from './auth/roles.guard.js'

import {
    ProductsController
} from './products.controller.js'

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
        OrdersController,
        AuthController,
        ProductsController
    ],

    providers: [
        OrderEventsService,
        OrdersService,
        OrdersGateway,
        RabbitPublisher,
        RabbitConsumer,
        AuthService,
        AuthGuard,
        RolesGuard
    ]
})
export class AppModule { }