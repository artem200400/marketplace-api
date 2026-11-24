import { RabbitOutboxRelay } from './outbox/rabbit-relay.service.js'

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
    FilesController
} from './files/files.controller.js'

import {
    FilesService
} from './files/files.service.js'

import {
    ObserveController
} from './observability/observe.controller.js'

import {
    ObserveService
} from './observability/observe.service.js'

import {
    ObserveRepository
} from './observability/observe.repository.js'

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
        FilesController,
        ObserveController
    ],

    providers: [
        OrderEventsService,
        OrdersService,
        OrdersGateway,
        RabbitPublisher,
        RabbitConsumer,
        RabbitOutboxRelay,
        FilesService,
        ObserveService,
        ObserveRepository
    ]
})
export class AppModule { }