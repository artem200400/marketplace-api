import { spawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'
import { inTransaction, placeOrder } from './order-service.js'
import { relayOnce } from './relay.js'

const mode = process.argv[2]
const brokerUrl = process.env.BROKER_URL ?? 'http://127.0.0.1:18765'
const pool = new Pool({ connectionString: process.env.DATABASE_URL ?? process.env.DB_URL })
const demoEmail = 'hw22-demo@example.invalid'
const key = 'hw22:' + mode

async function count(query: string, params: unknown[] = []): Promise<number> {
  const r = await pool.query<{ n: number }>(query, params)
  return Number(r.rows[0].n)
}

async function prepare(): Promise<{ userId: string; productId: string }> {
  // Never wipe unrelated orders or broker messages.
  const user = (await pool.query<{ id: string }>(`
    INSERT INTO users(name,email,balance_cents)
    VALUES('HW22 Demo','hw22-demo@example.invalid',1000000)
    ON CONFLICT(email) DO UPDATE SET name=EXCLUDED.name
    RETURNING id::text
  `)).rows[0]
  const client = await pool.connect()
  try {
    await inTransaction(client, async () => {
      const old = (await client.query<{ order_id: string | null }>(
        'SELECT order_id::text FROM order_idempotency WHERE user_id=$1 AND idempotency_key=$2',
        [user.id, key]
      )).rows.map(r => r.order_id).filter((id): id is string => id !== null)
      for (const id of old) {
        const events = (await client.query<{ id: string }>(
          'SELECT id FROM outbox WHERE aggregate_type=$1 AND aggregate_id=$2', ['Order', id]
        )).rows
        for (const event of events) {
          await client.query('DELETE FROM broker_deliveries WHERE message_id=$1', [event.id])
          await client.query('DELETE FROM processed_messages WHERE message_id=$1', [event.id])
        }
        await client.query('DELETE FROM order_effects WHERE order_id=$1', [id])
        await client.query('DELETE FROM outbox WHERE aggregate_type=$1 AND aggregate_id=$2', ['Order', id])
        await client.query('DELETE FROM order_items WHERE order_id=$1', [id])
      }
      await client.query(
        'DELETE FROM order_idempotency WHERE user_id=$1 AND idempotency_key=$2', [user.id, key]
      )
      for (const id of old) await client.query('DELETE FROM orders WHERE id=$1', [id])
    })
  } finally {
    client.release()
  }

  let product = (await pool.query<{ id: string }>(
    "SELECT id::text FROM products WHERE name='HW22 Demo Product' ORDER BY id LIMIT 1"
  )).rows[0]
  if (!product) {
    product = (await pool.query<{ id: string }>(
      "INSERT INTO products(name,description,price_cents,stock) VALUES('HW22 Demo Product','demo',100,100) RETURNING id::text"
    )).rows[0]
  }
  return { userId: user.id, productId: product.id }
}

async function startBroker(): Promise<ChildProcess> {
  const script = fileURLToPath(new URL('./http-broker.js', import.meta.url))
  const child = spawn(process.execPath, [script], {
    env: { ...process.env, BROKER_URL: brokerUrl }, stdio: ['ignore', 'ignore', 'inherit']
  })
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error('BROKER_EXITED')
    try {
      const response = await fetch(new URL('/health', brokerUrl))
      if (response.ok) return child
    } catch { /* starting */ }
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  child.kill()
  throw new Error('BROKER_NOT_READY')
}

function output(values: Record<string, number>, expected: Record<string, number>): void {
  for (const [key, value] of Object.entries(values)) console.log(`${key}=${value}`)
  for (const [name, value] of Object.entries(expected)) {
    if (name === 'deliveries' ? values[name] < value : values[name] !== value) {
      throw new Error(`INVARIANT_FAILED: ${name} expected ${name === 'deliveries' ? '>=' : ''}${value}; got ${values[name]}`)
    }
  }
}

async function main(): Promise<void> {
  if (!['outbox', 'crash-write', 'crash-relay'].includes(mode)) throw new Error('INVALID_DEMO')
  const ids = await prepare()
  const input = {
    userId: ids.userId, idempotencyKey: key,
    items: [{ product_id: ids.productId, quantity: 1 }]
  }
  let broker: ChildProcess | undefined
  try {
    if (mode !== 'crash-write') broker = await startBroker()
    if (mode === 'crash-write') {
      let failed = 0
      const client = await pool.connect()
      try {
        try {
          await inTransaction(client, () => placeOrder(client, input, { failAfterOutbox: true }))
        } catch (error) {
          if (error instanceof Error && error.message === 'SIMULATED_WRITE_CRASH') failed = 1
          else throw error
        }
      } finally { client.release() }
      const values = {
        'write-failed': failed,
        orders: await count('SELECT count(*)::int n FROM order_idempotency WHERE user_id=$1 AND idempotency_key=$2', [ids.userId, key]),
        outbox: await count("SELECT count(*)::int n FROM outbox WHERE aggregate_type='Order' AND aggregate_id IN (SELECT order_id::text FROM order_idempotency WHERE user_id=$1 AND idempotency_key=$2)", [ids.userId,key]),
        published: 0, deliveries: 0, effect: 0
      }
      output(values, { 'write-failed': 1, orders: 0, outbox: 0, published: 0, deliveries: 0, effect: 0 })
      return
    }

    const client = await pool.connect()
    let response: Awaited<ReturnType<typeof placeOrder>>
    try {
      response = await inTransaction(client, () => placeOrder(client, input))
      if (mode === 'outbox') {
        const again = await inTransaction(client, () => placeOrder(client, input))
        if (again.id !== response.id) throw new Error('DUPLICATE_ORDER')
      }
    } finally { client.release() }
    if (mode === 'crash-relay') {
      try {
        await relayOnce(pool, brokerUrl, { crashAfterPublish: true })
        throw new Error('RELAY_DID_NOT_CRASH')
      } catch (error) {
        if (!(error instanceof Error) || error.message !== 'SIMULATED_RELAY_CRASH') throw error
      }
    }
    const published = await relayOnce(pool, brokerUrl)
    const messageIds = (await pool.query<{ id: string }>(
      "SELECT id FROM outbox WHERE aggregate_type='Order' AND aggregate_id=$1", [response.id]
    )).rows.map(r => r.id)
    const deliveries = await count('SELECT count(*)::int n FROM broker_deliveries WHERE message_id=ANY($1::uuid[])', [messageIds])
    const effect = await count('SELECT count(*)::int n FROM order_effects WHERE order_id=$1', [response.id])
    const processed = await count(
      "SELECT count(*)::int n FROM processed_messages WHERE consumer='order-effects' AND message_id=ANY($1::uuid[])", [messageIds]
    )
    if (mode === 'outbox') {
      const values = {
        requests: 2,
        orders: await count('SELECT count(*)::int n FROM orders WHERE id=$1', [response.id]),
        outbox: messageIds.length, published, deliveries, effect, processed
      }
      output(values, { requests: 2, orders: 1, outbox: 1, published: 1, effect: 1, processed: 1 })
    } else {
      const values = { published, deliveries, applied: effect, effect, processed }
      output(values, { published: 1, deliveries: 2, applied: 1, effect: 1, processed: 1 })
    }
  } finally {
    broker?.kill('SIGTERM')
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
}).finally(async () => { await pool.end() })
