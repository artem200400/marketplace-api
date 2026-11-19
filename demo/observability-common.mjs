import {
  spawn,
  spawnSync
} from 'node:child_process'

const APP_PORT = 22929

export function buildApp() {
  const result =
    spawnSync(
      process.execPath,
      [
        './node_modules/typescript/bin/tsc'
      ],
      {
        encoding: 'utf8'
      }
    )

  if (
    result.status !== 0
  ) {
    process.stderr.write(
      result.stdout ?? ''
    )
    process.stderr.write(
      result.stderr ?? ''
    )

    throw new Error(
      `tsc failed with ${result.status}`
    )
  }
}

export function traceparent(
  traceId,
  parentId
) {
  return `00-${traceId}-${parentId}-01`
}

export function appUrl(
  path
) {
  return `http://127.0.0.1:${APP_PORT}${path}`
}

export async function startApp() {
  const lines = []
  let buffer = ''

  const child =
    spawn(
      process.execPath,
      [
        'dist/main.js'
      ],
      {
        env: {
          ...process.env,
          PORT:
            String(
              APP_PORT
            ),
          APP_WARMUP_MS:
            '0',
          APP_DRAIN_MS:
            '0',
          DB_HOST:
            process.env.DB_HOST ??
            '127.0.0.1',
          DB_PORT:
            process.env.DB_PORT ??
            '6432',
          DB_NAME:
            process.env.DB_NAME ??
            'marketplace',
          DB_USER:
            process.env.DB_USER ??
            'marketplace_user',
          DB_PASSWORD_FILE:
            process.env.DB_PASSWORD_FILE ??
            'secrets/db_password',
          DB_URL:
            process.env.DB_URL ??
            'postgresql://marketplace_user:marketplace_password@127.0.0.1:6432/marketplace',
          OTEL_EXPORTER_OTLP_ENDPOINT:
            process.env
              .OTEL_EXPORTER_OTLP_ENDPOINT ??
            'http://127.0.0.1:22918'
        },
        stdio: [
          'ignore',
          'pipe',
          'pipe'
        ]
      }
    )

  child.stdout.setEncoding(
    'utf8'
  )

  child.stdout.on(
    'data',
    chunk => {
      buffer += chunk

      while (
        buffer.includes(
          '\n'
        )
      ) {
        const index =
          buffer.indexOf(
            '\n'
          )

        const line =
          buffer
            .slice(
              0,
              index
            )
            .trim()

        buffer =
          buffer.slice(
            index + 1
          )

        if (line) {
          lines.push(line)
        }
      }
    }
  )

  let stderr = ''

  child.stderr.setEncoding(
    'utf8'
  )

  child.stderr.on(
    'data',
    chunk => {
      stderr += chunk
    }
  )

  const deadline =
    Date.now() +
    15000

  while (
    Date.now() <
    deadline
  ) {
    const ready =
      lines.some(
        line => {
          try {
            return (
              JSON.parse(line)
                .message ===
              'app_ready'
            )
          }
          catch {
            return false
          }
        }
      )

    if (ready) {
      return {
        child,
        lines,
        getStderr:
          () => stderr
      }
    }

    if (
      child.exitCode !==
      null
    ) {
      throw new Error(
        `API exited early: ${stderr}`
      )
    }

    await new Promise(
      resolve =>
        setTimeout(
          resolve,
          50
        )
    )
  }

  child.kill()

  throw new Error(
    `API did not become ready: ${stderr}`
  )
}

export async function stopApp(
  child
) {
  if (
    child.exitCode !==
    null
  ) {
    return
  }

  child.kill(
    'SIGTERM'
  )

  const deadline =
    Date.now() +
    5000

  while (
    child.exitCode ===
      null &&
    Date.now() <
      deadline
  ) {
    await new Promise(
      resolve =>
        setTimeout(
          resolve,
          50
        )
    )
  }

  if (
    child.exitCode ===
    null
  ) {
    child.kill(
      'SIGKILL'
    )
  }
}

export async function request(
  path,
  {
    method = 'GET',
    headers = {},
    body
  } = {}
) {
  return fetch(
    appUrl(path),
    {
      method,
      headers: {
        ...headers,
        ...(body === undefined
          ? {}
          : {
              'content-type':
                'application/json'
            })
      },
      body:
        body === undefined
          ? undefined
          : JSON.stringify(body)
    }
  )
}

export function parseJsonLines(
  lines
) {
  const parsed = []
  let nonJson = 0

  for (
    const line
    of lines
  ) {
    try {
      parsed.push(
        JSON.parse(line)
      )
    }
    catch {
      nonJson += 1
    }
  }

  return {
    parsed,
    nonJson
  }
}

export async function resetTraces() {
  const url =
    process.env
      .TRACE_API_URL ??
    'http://127.0.0.1:22904'

  const response =
    await fetch(
      new URL(
        '/reset',
        url
      ),
      {
        method: 'POST'
      }
    )

  if (!response.ok) {
    throw new Error(
      'trace receiver reset failed'
    )
  }
}

export async function readTrace(
  traceId
) {
  const base =
    process.env
      .TRACE_API_URL ??
    'http://127.0.0.1:22904'

  const url =
    new URL(
      '/traces',
      base
    )

  url.searchParams.set(
    'trace_id',
    traceId
  )

  const response =
    await fetch(url)

  if (!response.ok) {
    throw new Error(
      'trace receiver query failed'
    )
  }

  return response.json()
}
