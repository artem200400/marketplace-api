import {
    currentContext
} from './context.js'

type LogFields =
    Record<
        string,
        unknown
    >

function sanitize(
    fields: LogFields
): LogFields {
    const copy: LogFields = {
        ...fields
    }

    for (
        const key
        of [
            'authorization',
            'password',
            'refreshToken',
            'accessToken',
            'body'
        ]
    ) {
        if (
            key in copy &&
            copy[key] !== undefined
        ) {
            copy[key] =
                '[Redacted]'
        }
    }

    return copy
}

export function logJson(
    layer: string,
    message: string,
    fields: LogFields = {}
): void {
    const context =
        currentContext()

    const line = {
        level:
            'info',
        time:
            new Date()
                .toISOString(),
        layer,
        message,
        trace_id:
            context?.traceId,
        span_id:
            context?.spanId,
        userId:
            context?.userId,
        tenant:
            context?.tenant,
        idempotencyKey:
            context
                ?.idempotencyKey,
        path:
            context?.path,
        method:
            context?.method,
        ...sanitize(
            fields
        )
    }

    console.log(
        JSON.stringify(
            line
        )
    )
}

export function logError(
    layer: string,
    message: string,
    fields: LogFields = {}
): void {
    const context =
        currentContext()

    console.log(
        JSON.stringify({
            level:
                'error',
            time:
                new Date()
                    .toISOString(),
            layer,
            message,
            trace_id:
                context?.traceId,
            span_id:
                context?.spanId,
            path:
                context?.path,
            method:
                context?.method,
            ...sanitize(
                fields
            )
        })
    )
}
