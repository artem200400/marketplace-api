import {
  buildApp,
  parseJsonLines,
  request,
  startApp,
  stopApp,
  traceparent
} from './observability-common.mjs'

buildApp()

const app =
  await startApp()

try {
  const singleTrace =
    '11111111111111111111111111111111'

  await request(
    '/observe/single',
    {
      headers: {
        traceparent:
          traceparent(
            singleTrace,
            '1111111111111111'
          )
      }
    }
  )

  const burstCount = 8

  await Promise.all(
    Array.from(
      {
        length:
          burstCount
      },
      (
        _,
        index
      ) => {
        const traceId =
          (
            index +
            10
          )
            .toString(16)
            .padStart(
              32,
              '0'
            )

        const parentId =
          (
            index +
            10
          )
            .toString(16)
            .padStart(
              16,
              '0'
            )

        return request(
          `/observe/burst-${index}`,
          {
            headers: {
              traceparent:
                traceparent(
                  traceId,
                  parentId
                )
            }
          }
        )
      }
    )
  )

  const authMarker =
    'HW29_SECRET_AUTH_MARKER'

  const passwordMarker =
    'HW29_PASSWORD_MARKER'

  await request(
    '/observe/secret',
    {
      method:
        'POST',
      headers: {
        authorization:
          `Bearer ${authMarker}`,
        traceparent:
          traceparent(
            '22222222222222222222222222222222',
            '2222222222222222'
          )
      },
      body: {
        password:
          passwordMarker
      }
    }
  )

  await new Promise(
    resolve =>
      setTimeout(
        resolve,
        150
      )
  )

  const {
    parsed,
    nonJson
  } =
    parseJsonLines(
      app.lines
    )

  const single =
    parsed.filter(
      line =>
        line.path ===
        '/observe/single'
    )

  const layers =
    new Set(
      single
        .map(
          line =>
            line.layer
        )
        .filter(
          Boolean
        )
    ).size

  const singleTraceIds =
    new Set(
      single
        .map(
          line =>
            line.trace_id
        )
        .filter(
          Boolean
        )
    )

  const burstLines =
    parsed.filter(
      line =>
        typeof line.path ===
          'string' &&
        line.path.startsWith(
          '/observe/burst-'
        )
    )

  const byTrace =
    new Map()

  for (
    const line
    of burstLines
  ) {
    if (
      !line.trace_id
    ) {
      continue
    }

    byTrace.set(
      line.trace_id,
      (
        byTrace.get(
          line.trace_id
        ) ??
        0
      ) +
      1
    )
  }

  const counts =
    [
      ...byTrace.values()
    ]

  const burstUneven =
    counts.length === 0
      ? 1
      : new Set(
          counts
        ).size === 1
        ? 0
        : 1

  const secretLines =
    parsed.filter(
      line =>
        line.path ===
        '/observe/secret'
    )

  const secretText =
    JSON.stringify(
      secretLines
    )

  const values = {
    'non-json-lines':
      nonJson,
    layers,
    'distinct-trace-ids':
      singleTraceIds.size,
    'trace-id-matches-header':
      (
        singleTraceIds.size ===
          1 &&
        singleTraceIds.has(
          singleTrace
        )
      )
        ? 1
        : 0,
    burst:
      burstCount,
    'burst-trace-ids':
      byTrace.size,
    'burst-uneven':
      burstUneven,
    'secret-req-logged':
      secretLines.length >
      0
        ? 1
        : 0,
    'secret-in-logs':
      (
        secretText.includes(
          authMarker
        ) ||
        secretText.includes(
          passwordMarker
        )
      )
        ? 1
        : 0
  }

  for (
    const [
      key,
      value
    ]
    of Object.entries(
      values
    )
  ) {
    console.log(
      `${key}=${value}`
    )
  }

  const ok =
    values[
      'non-json-lines'
    ] === 0 &&
    values.layers >= 3 &&
    values[
      'distinct-trace-ids'
    ] === 1 &&
    values[
      'trace-id-matches-header'
    ] === 1 &&
    values.burst >= 8 &&
    values[
      'burst-trace-ids'
    ] ===
      values.burst &&
    values[
      'burst-uneven'
    ] === 0 &&
    values[
      'secret-req-logged'
    ] === 1 &&
    values[
      'secret-in-logs'
    ] === 0

  if (!ok) {
    process.exitCode = 1
  }
}
finally {
  await stopApp(
    app.child
  )
}
