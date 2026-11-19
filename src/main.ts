import 'reflect-metadata'

import { NestFactory } from '@nestjs/core'
import { ConfigService } from '@nestjs/config'

import { AppModule } from './app.module.js'
import type { Env } from './config/env.schema.js'
import {
    markNotReady,
    markReady
} from './runtime-state.js'

import {
    observabilityMiddleware
} from './observability/http.middleware.js'

import {
    logJson
} from './observability/logger.js'

import {
    flushSpans
} from './observability/tracing.js'

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
            AppModule,
            {
                logger: false
            }
        )

    app.use(
        observabilityMiddleware
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

            logJson(
                'runtime',
                'draining',
                {
                    signal
                }
            )

            markNotReady()

            await sleep(
                drainMs
            )

            await flushSpans()
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

    logJson(
        'runtime',
        'app_ready',
        {
            port
        }
    )
}

void bootstrap()
