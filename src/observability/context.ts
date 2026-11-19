import {
    AsyncLocalStorage
} from 'node:async_hooks'

import {
    randomBytes
} from 'node:crypto'

export type TraceContext = {
    traceId: string
    spanId: string
    parentSpanId?: string
    path: string
    method: string
    userId?: string
    tenant?: string
    idempotencyKey?: string
}

const storage =
    new AsyncLocalStorage<TraceContext>()

export function currentContext():
    TraceContext | undefined {
    return storage.getStore()
}

export function runWithContext<T>(
    context: TraceContext,
    fn: () => T
): T {
    return storage.run(
        context,
        fn
    )
}

export function randomTraceId(): string {
    return randomBytes(16)
        .toString('hex')
}

export function randomSpanId(): string {
    return randomBytes(8)
        .toString('hex')
}
