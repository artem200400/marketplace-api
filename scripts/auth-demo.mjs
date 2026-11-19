import {
  spawn,
  spawnSync
} from 'node:child_process'

import {
  randomBytes,
  scryptSync
} from 'node:crypto'

import pg from 'pg'

const mode = process.argv[2]
const ports = {
  auth: 23241,
  reuse: 23242,
  rbac: 23243
}

if (!ports[mode]) {
  throw new Error('mode must be auth, reuse or rbac')
}

const databaseUrl =
  process.env.DATABASE_URL ??
  process.env.DB_URL

if (!databaseUrl) {
  throw new Error('DATABASE_URL or DB_URL is required')
}

const port = ports[mode]

function hashPassword(password) {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, 32)

  return [
    'scrypt',
    salt.toString('base64url'),
    hash.toString('base64url')
  ].join('$')
}

function run(command, args, options = {}) {
  const result = spawnSync(
    command,
    args,
    {
      stdio: 'inherit',
      shell: false,
      env: process.env,
      ...options
    }
  )

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} exited ${result.status}`
    )
  }
}

async function waitForServer() {
  for (let i = 0; i < 100; i += 1) {
    try {
      const response =
        await fetch(
          `http://127.0.0.1:${port}/health`
        )

      if (response.ok) {
        return
      }
    } catch {}

    await new Promise(resolve =>
      setTimeout(resolve, 100)
    )
  }

  throw new Error('API did not start')
}

async function request(
  path,
  {
    method = 'GET',
    token,
    body
  } = {}
) {
  const headers = {
    'content-type': 'application/json'
  }

  if (token) {
    headers.authorization =
      `Bearer ${token}`
  }

  const response =
    await fetch(
      `http://127.0.0.1:${port}${path}`,
      {
        method,
        headers,
        body:
          body === undefined
            ? undefined
            : JSON.stringify(body)
      }
    )

  let json = null

  try {
    json = await response.json()
  } catch {}

  return {
    status: response.status,
    body: json
  }
}

function tamperRole(token) {
  const parts = token.split('.')
  const payload =
    JSON.parse(
      Buffer.from(
        parts[1],
        'base64url'
      ).toString('utf8')
    )

  payload.role = 'admin'

  parts[1] =
    Buffer.from(
      JSON.stringify(payload)
    ).toString('base64url')

  return parts.join('.')
}

const pool =
  new pg.Pool({
    connectionString:
      databaseUrl
  })

async function prepareData() {
  await pool.query(
    'DELETE FROM access_token_denylist'
  )
  await pool.query(
    'DELETE FROM refresh_tokens'
  )

  const emails = [
    'hw24-buyer@example.com',
    'hw24-other@example.com',
    'hw24-seller@example.com'
  ]

  const users = {}

  for (const [
    index,
    email
  ] of emails.entries()) {
    const role =
      index === 2
        ? 'seller'
        : 'buyer'

    const password =
      `hw24-pass-${index + 1}`

    const result =
      await pool.query(
        `
        INSERT INTO users (
          name,
          email,
          balance_cents,
          role,
          password_hash
        )
        VALUES (
          $1,
          $2,
          100000,
          $3,
          $4
        )
        ON CONFLICT (email)
        DO UPDATE SET
          role = EXCLUDED.role,
          password_hash =
            EXCLUDED.password_hash
        RETURNING id::text
        `,
        [
          `HW24 User ${index + 1}`,
          email,
          role,
          hashPassword(password)
        ]
      )

    users[email] = {
      id: result.rows[0].id,
      password,
      role
    }
  }

  await pool.query(
    `
    DELETE FROM order_items
    WHERE order_id IN (
      SELECT id
      FROM orders
      WHERE user_id = ANY($1::bigint[])
    )
    `,
    [[
      users[emails[0]].id,
      users[emails[1]].id
    ]]
  )

  await pool.query(
    `
    DELETE FROM orders
    WHERE user_id = ANY($1::bigint[])
    `,
    [[
      users[emails[0]].id,
      users[emails[1]].id
    ]]
  )

  const own =
    await pool.query(
      `
      INSERT INTO orders (
        user_id,
        status,
        total_amount_cents
      )
      VALUES ($1, 'pending', 0)
      RETURNING id::text
      `,
      [
        users[emails[0]].id
      ]
    )

  const foreign =
    await pool.query(
      `
      INSERT INTO orders (
        user_id,
        status,
        total_amount_cents
      )
      VALUES ($1, 'pending', 0)
      RETURNING id::text
      `,
      [
        users[emails[1]].id
      ]
    )

  await pool.query(
    `
    DELETE FROM products
    WHERE name LIKE 'HW24 demo %'
    `
  )

  return {
    buyer: {
      email: emails[0],
      ...users[emails[0]]
    },
    other: {
      email: emails[1],
      ...users[emails[1]]
    },
    seller: {
      email: emails[2],
      ...users[emails[2]]
    },
    ownOrderId:
      own.rows[0].id,
    foreignOrderId:
      foreign.rows[0].id
  }
}

async function login(user) {
  return request(
    '/auth/login',
    {
      method: 'POST',
      body: {
        email: user.email,
        password: user.password
      }
    }
  )
}

async function main() {
  run(
    process.execPath,
    [
      './node_modules/typescript/bin/tsc'
    ]
  )

  run('node', [
    './node_modules/typeorm/cli.js',
    'migration:run',
    '-d',
    'dist/data-source.js'
  ])

  const data =
    await prepareData()

  const server =
    spawn(
      process.execPath,
      [
        'dist/main.js'
      ],
      {
        env: {
          ...process.env,
          PORT: String(port)
        },
        stdio: [
          'ignore',
          'pipe',
          'pipe'
        ]
      }
    )

  server.stdout.pipe(
    process.stderr
  )
  server.stderr.pipe(
    process.stderr
  )

  try {
    await waitForServer()

    if (mode === 'auth') {
      const noToken =
        await request(
          '/auth/me'
        )

      const logged =
        await login(
          data.buyer
        )

      const access =
        logged.body.accessToken

      const refresh1 =
        logged.body.refreshToken

      const withToken =
        await request(
          '/auth/me',
          {
            token: access
          }
        )

      const refreshed =
        await request(
          '/auth/refresh',
          {
            method: 'POST',
            body: {
              refreshToken:
                refresh1
            }
          }
        )

      const refresh2 =
        refreshed.body
          .refreshToken

      const logout =
        await request(
          '/auth/logout',
          {
            method: 'POST',
            token:
              refreshed.body
                .accessToken,
            body: {
              refreshToken:
                refresh2
            }
          }
        )

      const afterLogout =
        await request(
          '/auth/me',
          {
            token:
              refreshed.body
                .accessToken
          }
        )

      const refreshAfterLogout =
        await request(
          '/auth/refresh',
          {
            method: 'POST',
            body: {
              refreshToken:
                refresh2
            }
          }
        )

      console.log(
        `login=${logged.status}`
      )
      console.log(
        `no-token=${noToken.status}`
      )
      console.log(
        `with-token=${withToken.status}`
      )
      console.log(
        `refresh=${refreshed.status}`
      )
      console.log(
        `logout=${logout.status}`
      )
      console.log(
        `after-logout=${afterLogout.status}`
      )
      console.log(
        `refresh-after-logout=${refreshAfterLogout.status}`
      )

      const ok =
        logged.status === 200 &&
        noToken.status === 401 &&
        withToken.status === 200 &&
        refreshed.status === 200 &&
        [200, 204].includes(
          logout.status
        ) &&
        afterLogout.status === 401 &&
        refreshAfterLogout.status === 401

      if (!ok) {
        process.exitCode = 1
      }
    }

    if (mode === 'reuse') {
      const logged =
        await login(
          data.buyer
        )

      const r1 =
        logged.body.refreshToken

      const firstRefresh =
        await request(
          '/auth/refresh',
          {
            method: 'POST',
            body: {
              refreshToken: r1
            }
          }
        )

      const r2 =
        firstRefresh.body
          .refreshToken

      const reuse =
        await request(
          '/auth/refresh',
          {
            method: 'POST',
            body: {
              refreshToken: r1
            }
          }
        )

      const afterReuse =
        await request(
          '/auth/refresh',
          {
            method: 'POST',
            body: {
              refreshToken: r2
            }
          }
        )

      console.log(
        `login=${logged.status}`
      )
      console.log(
        `r1-refresh=${firstRefresh.status}`
      )
      console.log(
        `r1-reuse=${reuse.status}`
      )
      console.log(
        `r2-after-reuse=${afterReuse.status}`
      )

      if (!(
        logged.status === 200 &&
        firstRefresh.status === 200 &&
        reuse.status === 401 &&
        afterReuse.status === 401
      )) {
        process.exitCode = 1
      }
    }

    if (mode === 'rbac') {
      const buyerLogin =
        await login(
          data.buyer
        )

      const sellerLogin =
        await login(
          data.seller
        )

      const buyerToken =
        buyerLogin.body
          .accessToken

      const sellerToken =
        sellerLogin.body
          .accessToken

      const anon =
        await request(
          `/orders/${data.ownOrderId}`
        )

      const own =
        await request(
          `/orders/${data.ownOrderId}`,
          {
            token: buyerToken
          }
        )

      const foreign =
        await request(
          `/orders/${data.foreignOrderId}`,
          {
            token: buyerToken
          }
        )

      const roleDenied =
        await request(
          '/products',
          {
            method: 'POST',
            token: buyerToken,
            body: {
              name:
                'HW24 demo denied'
            }
          }
        )

      const roleAllowed =
        await request(
          '/products',
          {
            method: 'POST',
            token: sellerToken,
            body: {
              name:
                'HW24 demo allowed'
            }
          }
        )

      const tampered =
        await request(
          '/products',
          {
            method: 'POST',
            token:
              tamperRole(
                buyerToken
              ),
            body: {
              name:
                'HW24 demo tampered'
            }
          }
        )

      console.log(
        `anon=${anon.status}`
      )
      console.log(
        `own=${own.status}`
      )
      console.log(
        `foreign=${foreign.status}`
      )
      console.log(
        `role-denied=${roleDenied.status}`
      )
      console.log(
        `role-allowed=${roleAllowed.status}`
      )
      console.log(
        `tampered=${tampered.status}`
      )

      if (!(
        anon.status === 401 &&
        own.status === 200 &&
        foreign.status === 403 &&
        roleDenied.status === 403 &&
        [200, 201].includes(
          roleAllowed.status
        ) &&
        tampered.status === 401
      )) {
        process.exitCode = 1
      }
    }
  } finally {
    server.kill('SIGTERM')

    await new Promise(resolve =>
      setTimeout(resolve, 250)
    )

    await pool.query(
      'DELETE FROM access_token_denylist'
    )
    await pool.query(
      'DELETE FROM refresh_tokens'
    )

    await pool.end()
  }
}

main().catch(async error => {
  console.error(error)

  await pool.end()
    .catch(() => undefined)

  process.exit(1)
})
