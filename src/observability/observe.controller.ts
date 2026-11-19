import {
    Body,
    Controller,
    Get,
    Param,
    Post,
    Res
} from '@nestjs/common'

import type {
    Response
} from 'express'

import {
    logJson
} from './logger.js'

import {
    metricsText
} from './metrics.js'

import {
    ObserveService
} from './observe.service.js'

@Controller()
export class ObserveController {
    constructor(
        private readonly service:
            ObserveService
    ) { }

    @Get('observe/:id')
    async observe(
        @Param('id')
        id: string
    ) {
        logJson(
            'observe.controller',
            'controller_enter',
            {
                observe_id:
                    id
            }
        )

        return this.service
            .execute(
                id
            )
    }

    @Post('observe/:id')
    async observePost(
        @Param('id')
        id: string,

        @Body()
        _body: unknown
    ) {
        logJson(
            'observe.controller',
            'controller_enter',
            {
                observe_id:
                    id
            }
        )

        return this.service
            .execute(
                id
            )
    }

    @Get('metrics')
    metrics(
        @Res()
        response: Response
    ) {
        response
            .type(
                'text/plain; version=0.0.4'
            )
            .send(
                metricsText()
            )
    }
}
