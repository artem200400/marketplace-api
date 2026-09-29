import 'reflect-metadata'

import { NestFactory } from '@nestjs/core'
import { ConfigService } from '@nestjs/config'

import { AppModule } from './app.module.js'
import type { Env } from './config/env.schema.js'

async function bootstrap() {
    const app = await NestFactory.create(AppModule)

    const config =
        app.get<ConfigService<Env, true>>(ConfigService)

    const port = config.get('PORT', {
        infer: true
    })

    await app.listen(port)

    console.log(
        `Marketplace API listening on http://localhost:${port}`
    )
}

bootstrap()