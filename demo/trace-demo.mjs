import {
  buildApp,
  parseJsonLines,
  readTrace,
  request,
  resetTraces,
  startApp,
  stopApp,
  traceparent
} from './observability-common.mjs'

buildApp()

await resetTraces()

const app =
  await startApp()

try {
  const traceId =
    '33333333333333333333333333333333'

  const remoteParent =
    '3333333333333333'

  await request(
    '/observe/fail-trace',
    {
      headers: {
        traceparent:
          traceparent(
            traceId,
            remoteParent
          )
      }
    }
  )

  let trace = {
    spans: []
  }

  const deadline =
    Date.now() +
    5000

  while (
    Date.now() <
      deadline
  ) {
    trace =
      await readTrace(
        traceId
      )

    if (
      trace.spans.length >=
      2
    ) {
      break
    }

    await new Promise(
      resolve =>
        setTimeout(
          resolve,
          100
        )
    )
  }

  const {
    parsed
  } =
    parseJsonLines(
      app.lines
    )

  const requestLogs =
    parsed.filter(
      line =>
        line.path ===
        '/observe/fail-trace'
    )

  const spanIds =
    new Set(
      trace.spans.map(
        span =>
          span.spanId
      )
    )

  let orphanSpans = 0

  for (
    const span
    of trace.spans
  ) {
    if (
      span.kind ===
      'server'
    ) {
      if (
        span.parentSpanId &&
        span.parentSpanId !==
        remoteParent
      ) {
        orphanSpans += 1
      }

      continue
    }

    if (
      !span.parentSpanId ||
      !spanIds.has(
        span.parentSpanId
      )
    ) {
      orphanSpans += 1
    }
  }

  const traceMatchesHeader =
    (
      trace.spans.length >
        0 &&
      trace.spans.every(
        span =>
          span.traceId ===
          traceId
      )
    )
      ? 1
      : 0

  const traceMatchesLog =
    (
      requestLogs.length >
        0 &&
      requestLogs.every(
        line =>
          line.trace_id ===
          traceId
      )
    )
      ? 1
      : 0

  const spanStatusError =
    trace.spans.some(
      span =>
        span.kind ===
          'server' &&
        span.status ===
          'ERROR'
    )
      ? 1
      : 0

  const values = {
    spans:
      trace.spans.length,
    'orphan-spans':
      orphanSpans,
    'trace-matches-header':
      traceMatchesHeader,
    'trace-matches-log':
      traceMatchesLog,
    'span-status-error':
      spanStatusError
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
    values.spans >= 2 &&
    values[
      'orphan-spans'
    ] === 0 &&
    values[
      'trace-matches-header'
    ] === 1 &&
    values[
      'trace-matches-log'
    ] === 1 &&
    values[
      'span-status-error'
    ] === 1

  if (!ok) {
    process.exitCode = 1
  }
}
finally {
  await stopApp(
    app.child
  )
}
