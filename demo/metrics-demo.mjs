import {
  buildApp,
  request,
  startApp,
  stopApp
} from './observability-common.mjs'

function parseSamples(
  text,
  metricName
) {
  return text
    .split(/\r?\n/)
    .filter(
      line =>
        line.startsWith(
          metricName
        )
    )
    .map(
      line => {
        const space =
          line.lastIndexOf(
            ' '
          )

        return {
          raw:
            line.slice(
              0,
              space
            ),
          value:
            Number(
              line.slice(
                space + 1
              )
            )
        }
      }
    )
}

function sum(
  values
) {
  return values.reduce(
    (
      total,
      value
    ) =>
      total +
      value,
    0
  )
}

buildApp()

const app =
  await startApp()

try {
  await request(
    '/observe/warm'
  )

  await request(
    '/observe/fail-warm'
  )

  const beforeText =
    await (
      await request(
        '/metrics'
      )
    ).text()

  const beforeCounters =
    parseSamples(
      beforeText,
      'marketplace_http_requests_total{'
    )
      .filter(
        sample =>
          sample.raw.includes(
            'route="/observe/:id"'
          )
      )

  const sentOk = 50
  const sentFail = 10

  for (
    let index = 0;
    index < sentOk;
    index += 1
  ) {
    await request(
      `/observe/ok-${index}`
    )
  }

  for (
    let index = 0;
    index < sentFail;
    index += 1
  ) {
    await request(
      `/observe/fail-${index}`
    )
  }

  const afterText =
    await (
      await request(
        '/metrics'
      )
    ).text()

  const afterCounters =
    parseSamples(
      afterText,
      'marketplace_http_requests_total{'
    )
      .filter(
        sample =>
          sample.raw.includes(
            'route="/observe/:id"'
          )
      )

  const beforeTotal =
    sum(
      beforeCounters.map(
        sample =>
          sample.value
      )
    )

  const afterTotal =
    sum(
      afterCounters.map(
        sample =>
          sample.value
      )
    )

  const beforeErrors =
    sum(
      beforeCounters
        .filter(
          sample =>
            sample.raw.includes(
              'status="500"'
            )
        )
        .map(
          sample =>
            sample.value
        )
    )

  const afterErrors =
    sum(
      afterCounters
        .filter(
          sample =>
            sample.raw.includes(
              'status="500"'
            )
        )
        .map(
          sample =>
            sample.value
        )
    )

  const countSamples =
    parseSamples(
      afterText,
      'marketplace_http_request_duration_seconds_count{'
    )
      .filter(
        sample =>
          sample.raw.includes(
            'route="/observe/:id"'
          )
      )

  const topBucketSamples =
    parseSamples(
      afterText,
      'marketplace_http_request_duration_seconds_bucket{'
    )
      .filter(
        sample =>
          sample.raw.includes(
            'route="/observe/:id"'
          ) &&
          sample.raw.includes(
            'le="10"'
          )
      )

  const aboveTopBucket =
    sum(
      countSamples.map(
        sample =>
          sample.value
      )
    ) -
    sum(
      topBucketSamples.map(
        sample =>
          sample.value
      )
    )

  const values = {
    'sent-ok':
      sentOk,
    'sent-fail':
      sentFail,
    'counter-delta':
      afterTotal -
      beforeTotal,
    'errors-delta':
      afterErrors -
      beforeErrors,
    'above-top-bucket':
      aboveTopBucket,
    'series-before':
      beforeCounters.length,
    'series-after':
      afterCounters.length
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
    values['sent-ok'] +
      values['sent-fail'] >=
      50 &&
    values[
      'counter-delta'
    ] ===
      values['sent-ok'] +
      values['sent-fail'] &&
    values[
      'errors-delta'
    ] ===
      values['sent-fail'] &&
    values[
      'above-top-bucket'
    ] === 0 &&
    values[
      'series-after'
    ] ===
      values[
        'series-before'
      ]

  if (!ok) {
    process.exitCode = 1
  }
}
finally {
  await stopApp(
    app.child
  )
}
