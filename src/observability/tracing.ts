import {
    randomSpanId
} from './context.js'

import {
    currentContext,
    runWithContext
} from './context.js'

export type ExportedSpan = {
    traceId: string
    spanId: string
    parentSpanId?: string
    name: string
    kind: 'server' | 'internal'
    status: 'UNSET' | 'OK' | 'ERROR'
    startedAt: string
    endedAt: string
}

const pending =
    new Set<Promise<void>>()

async function exportSpan(
    span: ExportedSpan
): Promise<void> {
    const endpoint =
        process.env
            .OTEL_EXPORTER_OTLP_ENDPOINT

    if (!endpoint) {
        return
    }

    const url =
        new URL(
            '/v1/traces',
            endpoint
        )

    await fetch(
        url,
        {
            method:
                'POST',
            headers: {
                'content-type':
                    'application/json'
            },
            body:
                JSON.stringify({
                    spans: [
                        span
                    ]
                })
        }
    )
}

export function queueSpan(
    span: ExportedSpan
): void {
    const task =
        exportSpan(
            span
        )
            .catch(
                () => undefined
            )
            .finally(
                () => {
                    pending.delete(
                        task
                    )
                }
            )

    pending.add(
        task
    )
}

export async function flushSpans():
    Promise<void> {
    await Promise.all(
        [
            ...pending
        ]
    )
}

export async function withSpan<T>(
    name: string,
    fn: () => Promise<T>
): Promise<T> {
    const parent =
        currentContext()

    if (!parent) {
        return fn()
    }

    const spanId =
        randomSpanId()

    const startedAt =
        new Date()
            .toISOString()

    let status:
        ExportedSpan['status'] =
        'OK'

    try {
        return await runWithContext(
            {
                ...parent,
                spanId,
                parentSpanId:
                    parent.spanId
            },
            fn
        )
    }
    catch (error) {
        status =
            'ERROR'

        throw error
    }
    finally {
        queueSpan({
            traceId:
                parent.traceId,
            spanId,
            parentSpanId:
                parent.spanId,
            name,
            kind:
                'internal',
            status,
            startedAt,
            endedAt:
                new Date()
                    .toISOString()
        })
    }
}
