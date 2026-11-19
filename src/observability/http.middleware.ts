import type {
    NextFunction,
    Request,
    Response
} from 'express'

import {
    randomSpanId,
    randomTraceId,
    runWithContext
} from './context.js'

import {
    logJson
} from './logger.js'

import {
    normalizeRoute,
    observeHttp
} from './metrics.js'

import {
    queueSpan
} from './tracing.js'

function parseTraceparent(
    value:
        string | undefined
) {
    const match =
        /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i
            .exec(
                value ?? ''
            )

    if (!match) {
        return {
            traceId:
                randomTraceId(),
            parentSpanId:
                undefined
        }
    }

    return {
        traceId:
            match[1]
                .toLowerCase(),
        parentSpanId:
            match[2]
                .toLowerCase()
    }
}

export function observabilityMiddleware(
    request: Request,
    response: Response,
    next: NextFunction
): void {
    const parsed =
        parseTraceparent(
            request.headers
                .traceparent as
                string | undefined
        )

    const spanId =
        randomSpanId()

    const started =
        process.hrtime.bigint()

    const startedAt =
        new Date()
            .toISOString()

    const path =
        request.path

    runWithContext(
        {
            traceId:
                parsed.traceId,
            spanId,
            parentSpanId:
                parsed.parentSpanId,
            path,
            method:
                request.method,
            userId:
                request.headers[
                    'x-user-id'
                ] as
                    string |
                    undefined,
            tenant:
                request.headers[
                    'x-tenant'
                ] as
                    string |
                    undefined,
            idempotencyKey:
                request.headers[
                    'idempotency-key'
                ] as
                    string |
                    undefined
        },
        () => {
            logJson(
                'http.middleware',
                'request_received',
                {
                    authorization:
                        request
                            .headers
                            .authorization,
                    body:
                        path.startsWith(
                            '/auth/'
                        )
                            ? '[Redacted]'
                            : undefined
                }
            )

            response.on(
                'finish',
                () => {
                    const duration =
                        Number(
                            process
                                .hrtime
                                .bigint() -
                            started
                        ) /
                        1_000_000_000

                    const route =
                        normalizeRoute(
                            path
                        )

                    if (
                        path !==
                            '/metrics' &&
                        path !==
                            '/healthz' &&
                        path !==
                            '/readyz'
                    ) {
                        observeHttp(
                            {
                                method:
                                    request
                                        .method,
                                route,
                                status:
                                    String(
                                        response
                                            .statusCode
                                    )
                            },
                            duration
                        )
                    }

                    logJson(
                        'http.middleware',
                        'request_complete',
                        {
                            status:
                                response
                                    .statusCode,
                            route,
                            duration_ms:
                                Math.round(
                                    duration *
                                    1000 *
                                    1000
                                ) /
                                1000
                        }
                    )

                    queueSpan({
                        traceId:
                            parsed
                                .traceId,
                        spanId,
                        parentSpanId:
                            parsed
                                .parentSpanId,
                        name:
                            `${request.method} ${route}`,
                        kind:
                            'server',
                        status:
                            response
                                .statusCode >=
                            500
                                ? 'ERROR'
                                : 'UNSET',
                        startedAt,
                        endedAt:
                            new Date()
                                .toISOString()
                    })
                }
            )

            next()
        }
    )
}
