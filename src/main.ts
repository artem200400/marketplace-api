import 'reflect-metadata'

import { NestFactory } from '@nestjs/core'
import { ConfigService } from '@nestjs/config'

import { AppModule } from './app.module.js'
import type { Env } from './config/env.schema.js'
import {
    markNotReady,
    markReady
} from './runtime-state.js'

const warmupMs =
    Number(
        process.env.APP_WARMUP_MS ??
        '4000'
    )

const drainMs =
    Number(
        process.env.APP_DRAIN_MS ??
        '5000'
    )

async function sleep(
    ms: number
) {
    await new Promise<void>(
        resolve =>
            setTimeout(
                resolve,
                ms
            )
    )
}

async function bootstrap() {
    markNotReady()

    const app =
        await NestFactory.create(
            AppModule
        )

    const config =
        app.get<
            ConfigService<Env, true>
        >(ConfigService)

    const port =
        config.get(
            'PORT',
            {
                infer: true
            }
        )

    await sleep(
        warmupMs
    )

    await app.listen(
        port,
        '0.0.0.0'
    )

    markReady()

    let shuttingDown =
        false

    const shutdown =
        async (
            signal: string
        ) => {
            if (
                shuttingDown
            ) {
                return
            }

            shuttingDown =
                true

            console.log(
                `${signal}: draining`
            )

            markNotReady()

            await sleep(
                drainMs
            )

            await app.close()

            process.exit(0)
        }

    process.once(
        'SIGTERM',
        () => {
            void shutdown(
                'SIGTERM'
            )
        }
    )

    process.once(
        'SIGINT',
        () => {
            void shutdown(
                'SIGINT'
            )
        }
    )

    console.log(
        `Marketplace API listening on http://0.0.0.0:${port}`
    )
}

void bootstrap()
