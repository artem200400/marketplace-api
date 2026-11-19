import http from 'node:http'

let spans = []

function sendJson(
  response,
  status,
  value
) {
  const body =
    JSON.stringify(value)

  response.writeHead(
    status,
    {
      'content-type':
        'application/json',
      'content-length':
        Buffer.byteLength(body)
    }
  )

  response.end(body)
}

async function readJson(
  request
) {
  const chunks = []

  for await (
    const chunk
    of request
  ) {
    chunks.push(chunk)
  }

  if (
    chunks.length === 0
  ) {
    return {}
  }

  return JSON.parse(
    Buffer.concat(chunks)
      .toString('utf8')
  )
}

const ingest =
  http.createServer(
    async (
      request,
      response
    ) => {
      if (
        request.method === 'GET' &&
        request.url === '/health'
      ) {
        sendJson(
          response,
          200,
          {
            status: 'ok'
          }
        )

        return
      }

      if (
        request.method === 'POST' &&
        request.url === '/v1/traces'
      ) {
        try {
          const payload =
            await readJson(
              request
            )

          const incoming =
            Array.isArray(
              payload.spans
            )
              ? payload.spans
              : []

          spans.push(
            ...incoming
          )

          sendJson(
            response,
            200,
            {
              accepted:
                incoming.length
            }
          )
        }
        catch {
          sendJson(
            response,
            400,
            {
              error:
                'invalid json'
            }
          )
        }

        return
      }

      sendJson(
        response,
        404,
        {
          error:
            'not found'
        }
      )
    }
  )

const api =
  http.createServer(
    async (
      request,
      response
    ) => {
      const url =
        new URL(
          request.url ??
          '/',
          'http://127.0.0.1'
        )

      if (
        request.method === 'GET' &&
        url.pathname === '/health'
      ) {
        sendJson(
          response,
          200,
          {
            status: 'ok'
          }
        )

        return
      }

      if (
        request.method === 'POST' &&
        url.pathname === '/reset'
      ) {
        spans = []

        sendJson(
          response,
          200,
          {
            reset: true
          }
        )

        return
      }

      if (
        request.method === 'GET' &&
        url.pathname === '/traces'
      ) {
        const traceId =
          url.searchParams
            .get(
              'trace_id'
            )

        const result =
          traceId
            ? spans.filter(
                span =>
                  span.traceId ===
                  traceId
              )
            : spans

        sendJson(
          response,
          200,
          {
            spans: result
          }
        )

        return
      }

      sendJson(
        response,
        404,
        {
          error:
            'not found'
        }
      )
    }
  )

ingest.listen(
  22918,
  '0.0.0.0'
)

api.listen(
  22904,
  '0.0.0.0'
)

console.log(
  JSON.stringify({
    level: 'info',
    component:
      'trace-receiver',
    message:
      'ready',
    ingestPort:
      22918,
    apiPort:
      22904
  })
)
