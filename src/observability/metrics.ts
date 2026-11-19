type Labels = {
    method: string
    route: string
    status: string
}

const buckets = [
    0.01,
    0.025,
    0.05,
    0.1,
    0.25,
    0.5,
    1,
    2.5,
    5,
    10
]

const counters =
    new Map<string, number>()

const histogramCounts =
    new Map<string, number>()

const histogramSums =
    new Map<string, number>()

const histogramBuckets =
    new Map<string, number>()

function labelsKey(
    labels: Labels
): string {
    return [
        labels.method,
        labels.route,
        labels.status
    ].join('|')
}

export function normalizeRoute(
    path: string
): string {
    if (
        /^\/observe\/[^/]+$/
            .test(path)
    ) {
        return '/observe/:id'
    }

    if (
        /^\/orders\/[^/]+$/
            .test(path)
    ) {
        return '/orders/:id'
    }

    return path
}

export function observeHttp(
    labels: Labels,
    seconds: number
): void {
    const key =
        labelsKey(
            labels
        )

    counters.set(
        key,
        (
            counters.get(
                key
            ) ??
            0
        ) +
        1
    )

    histogramCounts.set(
        key,
        (
            histogramCounts.get(
                key
            ) ??
            0
        ) +
        1
    )

    histogramSums.set(
        key,
        (
            histogramSums.get(
                key
            ) ??
            0
        ) +
        seconds
    )

    for (
        const bucket
        of buckets
    ) {
        if (
            seconds <=
            bucket
        ) {
            const bucketKey =
                `${key}|${bucket}`

            histogramBuckets.set(
                bucketKey,
                (
                    histogramBuckets.get(
                        bucketKey
                    ) ??
                    0
                ) +
                1
            )
        }
    }
}

function escapeLabel(
    value: string
): string {
    return value
        .replaceAll(
            '\\',
            '\\\\'
        )
        .replaceAll(
            '"',
            '\\"'
        )
}

function formatLabels(
    key: string
): string {
    const [
        method,
        route,
        status
    ] =
        key.split('|')

    return [
        `method="${escapeLabel(method)}"`,
        `route="${escapeLabel(route)}"`,
        `status="${escapeLabel(status)}"`
    ].join(',')
}

export function metricsText():
    string {
    const lines: string[] = [
        '# HELP marketplace_http_requests_total Total HTTP requests',
        '# TYPE marketplace_http_requests_total counter'
    ]

    for (
        const [
            key,
            value
        ]
        of counters
    ) {
        lines.push(
            `marketplace_http_requests_total{${formatLabels(key)}} ${value}`
        )
    }

    lines.push(
        '# HELP marketplace_http_request_duration_seconds HTTP request duration',
        '# TYPE marketplace_http_request_duration_seconds histogram'
    )

    for (
        const [
            key,
            count
        ]
        of histogramCounts
    ) {
        for (
            const bucket
            of buckets
        ) {
            const bucketKey =
                `${key}|${bucket}`

            lines.push(
                `marketplace_http_request_duration_seconds_bucket{${formatLabels(key)},le="${bucket}"} ${histogramBuckets.get(bucketKey) ?? 0}`
            )
        }

        lines.push(
            `marketplace_http_request_duration_seconds_bucket{${formatLabels(key)},le="+Inf"} ${count}`
        )

        lines.push(
            `marketplace_http_request_duration_seconds_sum{${formatLabels(key)}} ${histogramSums.get(key) ?? 0}`
        )

        lines.push(
            `marketplace_http_request_duration_seconds_count{${formatLabels(key)}} ${count}`
        )
    }

    return (
        lines.join('\n') +
        '\n'
    )
}

export function topFiniteBucket():
    number {
    return buckets[
        buckets.length -
        1
    ]
}
